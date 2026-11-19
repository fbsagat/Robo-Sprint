import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer, WebSocket } from 'ws';
import {
  BOT_NAMES,
  DEFAULT_MATCH_SETTINGS,
  FIXED_DT,
  MAX_PLAYERS_PER_ROOM,
  ROBOT_CLASSES,
  ROBOT_PALETTES,
  sanitizeMatchSettings,
  TICK_RATE,
} from './src/game/constants';
import {
  countEditorStageObjects,
  createBlankEditorStage,
  EDITOR_BUILD_TIME_LIMIT,
  EDITOR_COURSE_TIME_LIMIT,
  EDITOR_MAP_PREVIEW_TIME,
  generateBotCustomStage,
  sanitizeSubmittedStage,
} from './src/game/editor';
import { generateStage } from './src/game/generator';
import { createRobotState, stepSimulation } from './src/game/physics';
import type {
  ClientMessage,
  CustomMapEntry,
  EditorCreatorStatus,
  GameEvent,
  GameMode,
  MatchSettings,
  MatchState,
  PlayerInput,
  RobotClassId,
  RobotState,
  RoomSummary,
  ServerMessage,
} from './src/game/types';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface ClientConn {
  id: string;
  ws: WebSocket;
  name: string;
  colorIndex: number;
  robotClass: RobotClassId;
  roomCode: string | null;
}

interface Room {
  code: string;
  hostId: string;
  gameMode: GameMode;
  matchSettings: MatchSettings;
  seed: number;
  botCount: number;
  clients: Map<string, ClientConn>;
  inputs: Map<string, PlayerInput>;
  match: MatchState;
  customMaps: Map<string, CustomMapEntry>;
  mapPlaylist: CustomMapEntry[];
  pendingEvents: GameEvent[];
  tickCounter: number;
  interval: NodeJS.Timeout | null;
}

const clients = new Map<string, ClientConn>();
const rooms = new Map<string, Room>();

let clientSeq = 1;

function randomRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return rooms.has(code) ? randomRoomCode() : code;
}

function sanitizeName(raw: unknown): string {
  const cleaned = String(raw ?? '').trim().slice(0, 14);
  return cleaned.length > 0 ? cleaned : 'Robô';
}

function sanitizeColorIndex(raw: unknown): number {
  const num = Number(raw);
  if (!Number.isFinite(num)) return 0;
  return Math.abs(Math.floor(num)) % ROBOT_PALETTES.length;
}

function sanitizeRobotClass(raw: unknown): RobotClassId {
  if (raw === 'balanced' || raw === 'speedster' || raw === 'jumper') {
    return raw;
  }
  return 'balanced';
}

function sanitizeGameMode(raw: unknown): GameMode {
  return raw === 'editor' ? 'editor' : 'classic';
}

function sanitizeBotCount(raw: unknown, maxBots: number): number {
  const num = Number(raw);
  if (!Number.isFinite(num)) return 0;
  return Math.max(0, Math.min(maxBots, Math.floor(num)));
}

function sendMsg(ws: WebSocket, msg: ServerMessage): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function broadcastToRoom(room: Room, msg: ServerMessage): void {
  const payload = JSON.stringify(msg);
  for (const client of room.clients.values()) {
    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(payload);
    }
  }
}

function getRoomSummaries(): RoomSummary[] {
  const list: RoomSummary[] = [];
  for (const room of rooms.values()) {
    const host = room.clients.get(room.hostId);
    list.push({
      code: room.code,
      hostName: host?.name ?? 'Host',
      gameMode: room.gameMode,
      matchSettings: room.matchSettings,
      humanCount: room.clients.size,
      botCount: room.botCount,
      maxPlayers: MAX_PLAYERS_PER_ROOM,
      stageNumber: room.match.stageNumber,
      phase: room.match.phase,
    });
  }
  return list;
}

function broadcastRoomsList(): void {
  const summaryMsg: ServerMessage = {
    type: 'rooms_list',
    rooms: getRoomSummaries(),
  };
  const payload = JSON.stringify(summaryMsg);
  for (const client of clients.values()) {
    if (!client.roomCode && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(payload);
    }
  }
}

function rebuildRoomRobots(room: Room, preserveScores = false): void {
  const oldScores = new Map<string, number>();
  if (preserveScores) {
    for (const r of room.match.robots) {
      oldScores.set(r.id, r.score);
    }
  }

  const robots: RobotState[] = [];
  let slot = 0;

  for (const client of room.clients.values()) {
    if (slot >= MAX_PLAYERS_PER_ROOM) break;
    robots.push(
      createRobotState({
        id: client.id,
        name: client.name,
        colorIndex: client.colorIndex % ROBOT_PALETTES.length,
        robotClass: client.robotClass,
        isBot: false,
        stage: room.match.stage,
        spawnSlot: slot++,
        score: oldScores.get(client.id) ?? 0,
      })
    );
  }

  const allowedBots = Math.max(0, Math.min(room.botCount, MAX_PLAYERS_PER_ROOM - robots.length));
  const usedColors = new Set(robots.map((r) => r.colorIndex));
  const botClasses: RobotClassId[] = ['balanced', 'speedster', 'jumper'];

  for (let b = 0; b < allowedBots; b++) {
    let colorIdx = (b + 1) % ROBOT_PALETTES.length;
    for (let attempt = 0; attempt < ROBOT_PALETTES.length; attempt++) {
      const candidate = (b + attempt + 1) % ROBOT_PALETTES.length;
      if (!usedColors.has(candidate)) {
        colorIdx = candidate;
        usedColors.add(candidate);
        break;
      }
    }
    const botId = `bot_${b + 1}`;
    robots.push(
      createRobotState({
        id: botId,
        name: BOT_NAMES[b % BOT_NAMES.length],
        colorIndex: colorIdx,
        robotClass: botClasses[b % botClasses.length],
        isBot: true,
        stage: room.match.stage,
        spawnSlot: slot++,
        score: oldScores.get(botId) ?? 0,
      })
    );
  }

  room.match.robots = robots;
}

/**
 * Starts the Editor Mode Map Creation & Creator Validation Phase ('editor_build')
 */
function startEditorBuildPhaseInRoom(room: Room): void {
  const cycleSeed = Math.floor(Math.random() * 1_000_000_000);
  const buildLimit = room.matchSettings.editorBuildTimeLimit || EDITOR_BUILD_TIME_LIMIT;
  const courseLimit = room.matchSettings.editorCourseTimeLimit || EDITOR_COURSE_TIME_LIMIT;
  const previewSecs =
    room.matchSettings.editorPreviewSeconds !== undefined
      ? room.matchSettings.editorPreviewSeconds
      : EDITOR_MAP_PREVIEW_TIME;

  room.seed = cycleSeed;
  room.gameMode = 'editor';
  room.match.gameMode = 'editor';
  room.match.matchSettings = room.matchSettings;
  room.match.stageNumber = 1;
  room.match.stage = createBlankEditorStage(1, 'foundry', cycleSeed);
  room.match.phase = 'editor_build';
  room.match.countdownTimer = 0;
  room.match.raceTime = 0;
  room.match.projectiles = [];
  room.match.traps = [];
  room.match.events = [];
  room.pendingEvents = [];
  room.match.podiumAutoTimer = 0;

  // Reset tournament scores at the beginning of a new Editor Mode cycle
  rebuildRoomRobots(room, false);
  room.customMaps.clear();
  room.mapPlaylist = [];

  const creators: EditorCreatorStatus[] = [];

  for (let i = 0; i < room.match.robots.length; i++) {
    const r = room.match.robots[i];
    if (r.isBot) {
      const botStage = generateBotCustomStage(r.name, i, cycleSeed + i * 101);
      const botBestTime = Number((9.5 + (i % 4) * 2.1).toFixed(1));
      const botEntry: CustomMapEntry = {
        creatorId: r.id,
        creatorName: r.name,
        creatorColorIndex: r.colorIndex,
        title: `Circuito de ${r.name}`,
        stage: botStage,
        validated: true,
        creatorBestTime: botBestTime,
        courseTimeLimit: courseLimit,
      };
      room.customMaps.set(r.id, botEntry);
      creators.push({
        playerId: r.id,
        playerName: r.name,
        colorIndex: r.colorIndex,
        isBot: true,
        validated: true,
        submitted: true,
        objectCount: countEditorStageObjects(botStage),
        creatorBestTime: botBestTime,
      });
    } else {
      creators.push({
        playerId: r.id,
        playerName: r.name,
        colorIndex: r.colorIndex,
        isBot: false,
        validated: false,
        submitted: false,
        objectCount: countEditorStageObjects(room.match.stage),
        creatorBestTime: null,
      });
    }
  }

  room.match.editorState = {
    buildTimeRemaining: buildLimit,
    buildTimeLimit: buildLimit,
    courseTimeLimit: courseLimit,
    previewTimeLimit: previewSecs,
    creators,
    currentMapIndex: 0,
    totalMaps: creators.length,
    currentMapCreatorId: null,
    currentMapCreatorName: null,
    currentMapTitle: null,
    currentMapCourseLimit: courseLimit,
    isTournamentFinal: false,
    roundResults: [],
  };

  broadcastToRoom(room, {
    type: 'stage_loaded',
    stage: room.match.stage,
    stageNumber: 1,
    hostId: room.hostId,
    botCount: room.botCount,
    gameMode: room.gameMode,
    matchSettings: room.matchSettings,
    editorState: room.match.editorState,
  });

  sendSnapshot(room);
}

/**
 * Compiles all validated maps created by players (and bots) into the tournament playlist
 * and begins the battle on Map #1.
 */
function compileEditorPlaylistAndStart(room: Room): void {
  const playlist: CustomMapEntry[] = [];
  const courseLimit = room.matchSettings.editorCourseTimeLimit || EDITOR_COURSE_TIME_LIMIT;

  // 1. Add human players' submitted validated maps in room order
  for (const client of room.clients.values()) {
    const existing = room.customMaps.get(client.id);
    if (existing && existing.validated) {
      playlist.push(existing);
    } else {
      // Fallback if build timer expired before human player finished submitting
      const fallbackStage = createBlankEditorStage(1, 'foundry', room.seed);
      playlist.push({
        creatorId: client.id,
        creatorName: client.name,
        creatorColorIndex: client.colorIndex,
        title: `Pista de ${client.name}`,
        stage: fallbackStage,
        validated: true,
        creatorBestTime: 10.0,
        courseTimeLimit: courseLimit,
      });
    }
  }

  // 2. Add bot creators' maps so every competitor's map is played in the tournament
  for (const r of room.match.robots) {
    if (r.isBot) {
      const botMap = room.customMaps.get(r.id);
      if (botMap) {
        playlist.push(botMap);
      }
    }
  }

  room.mapPlaylist = playlist;
  if (room.match.editorState) {
    room.match.editorState.totalMaps = playlist.length;
    room.match.editorState.roundResults = [];
  }

  startEditorPlaylistMap(room, 0, false);
}

/**
 * Loads map #mapIndex from the compiled Editor Mode playlist and spawns ALL players
 * (including the map creator!) into the race.
 */
function startEditorPlaylistMap(room: Room, mapIndex: number, preserveScores: boolean): void {
  const entry = room.mapPlaylist[mapIndex];
  if (!entry) return;

  const previewSecs =
    room.matchSettings.editorPreviewSeconds !== undefined
      ? room.matchSettings.editorPreviewSeconds
      : EDITOR_MAP_PREVIEW_TIME;
  const courseLimit = room.matchSettings.editorCourseTimeLimit || EDITOR_COURSE_TIME_LIMIT;

  const stageClone = sanitizeSubmittedStage(entry.stage, mapIndex + 1);
  room.match.stageNumber = mapIndex + 1;
  room.match.stage = stageClone;
  room.match.matchSettings = room.matchSettings;
  if (previewSecs > 0) {
    room.match.phase = 'map_preview';
    room.match.countdownTimer = previewSecs;
  } else {
    room.match.phase = 'countdown';
    room.match.countdownTimer = 1.8;
  }
  room.match.raceTime = 0;
  room.match.projectiles = [];
  room.match.traps = [];
  room.match.events = [];
  room.pendingEvents = [];
  room.match.podiumAutoTimer = 0;

  if (room.match.editorState) {
    room.match.editorState.currentMapIndex = mapIndex;
    room.match.editorState.totalMaps = room.mapPlaylist.length;
    room.match.editorState.currentMapCreatorId = entry.creatorId;
    room.match.editorState.currentMapCreatorName = entry.creatorName;
    room.match.editorState.currentMapTitle = entry.title;
    room.match.editorState.currentMapCourseLimit = entry.courseTimeLimit || courseLimit;
    room.match.editorState.previewTimeLimit = previewSecs;
    room.match.editorState.isTournamentFinal = mapIndex >= room.mapPlaylist.length - 1;
  }

  rebuildRoomRobots(room, preserveScores);

  for (const id of room.inputs.keys()) {
    room.inputs.set(id, {
      left: false,
      right: false,
      jump: false,
      jumpJustPressed: false,
      dashJustPressed: false,
      useItem: false,
    });
  }

  broadcastToRoom(room, {
    type: 'stage_loaded',
    stage: room.match.stage,
    stageNumber: room.match.stageNumber,
    hostId: room.hostId,
    botCount: room.botCount,
    gameMode: room.gameMode,
    matchSettings: room.matchSettings,
    editorState: room.match.editorState,
  });

  sendSnapshot(room);
}

function startStageInRoom(room: Room, stageNumber: number, preserveScores: boolean): void {
  const stageSeed = Math.floor(Math.random() * 1_000_000_000);
  room.seed = stageSeed;
  room.match.gameMode = room.gameMode;
  room.match.matchSettings = room.matchSettings;
  room.match.stageNumber = stageNumber;
  room.match.stage = generateStage(stageNumber, stageSeed, room.matchSettings);
  room.match.phase = 'countdown';
  room.match.countdownTimer = 1.6;
  room.match.raceTime = 0;
  room.match.projectiles = [];
  room.match.traps = [];
  room.match.events = [];
  room.pendingEvents = [];
  room.match.podiumAutoTimer = 0;

  rebuildRoomRobots(room, preserveScores);

  for (const id of room.inputs.keys()) {
    room.inputs.set(id, {
      left: false,
      right: false,
      jump: false,
      jumpJustPressed: false,
      dashJustPressed: false,
      useItem: false,
    });
  }

  broadcastToRoom(room, {
    type: 'stage_loaded',
    stage: room.match.stage,
    stageNumber: room.match.stageNumber,
    hostId: room.hostId,
    botCount: room.botCount,
    gameMode: room.gameMode,
    matchSettings: room.matchSettings,
    editorState: room.match.editorState,
  });

  sendSnapshot(room);
}

function sendSnapshot(room: Room): void {
  const crumblingStates = room.match.stage.platforms
    .filter((p) => p.kind === 'crumbling')
    .map((p) => ({ id: p.id, state: p.crumbleState ?? 'intact' }));

  const collectedCrystalIds = room.match.stage.crystals
    .filter((c) => c.respawnAt > 0)
    .map((c) => c.id);

  const eventsToSend = room.pendingEvents.length > 0 ? [...room.pendingEvents] : [];
  room.pendingEvents = [];
  room.match.events = [];

  broadcastToRoom(room, {
    type: 'state_snapshot',
    hostId: room.hostId,
    botCount: room.botCount,
    gameMode: room.gameMode,
    matchSettings: room.matchSettings,
    phase: room.match.phase,
    stageNumber: room.match.stageNumber,
    countdownTimer: room.match.countdownTimer,
    raceTime: room.match.raceTime,
    robots: room.match.robots,
    projectiles: room.match.projectiles,
    traps: room.match.traps,
    itemBoxes: room.match.stage.itemBoxes,
    collectedCrystalIds,
    crumblingStates,
    events: eventsToSend,
    editorState: room.match.editorState,
  });
}

function ensureRoomLoop(room: Room): void {
  if (room.interval) return;
  room.interval = setInterval(() => {
    if (room.match.phase === 'lobby' || room.match.phase === 'podium') {
      return;
    }

    if (room.match.phase === 'editor_build') {
      room.tickCounter++;
      if (room.match.editorState) {
        room.match.editorState.buildTimeRemaining = Math.max(
          0,
          room.match.editorState.buildTimeRemaining - FIXED_DT
        );
        if (room.match.editorState.buildTimeRemaining <= 0) {
          compileEditorPlaylistAndStart(room);
          return;
        }
      }
      // Broadcast editor countdown at ~4Hz
      if (room.tickCounter % 15 === 0) {
        sendSnapshot(room);
      }
      return;
    }

    const prevPhase = room.match.phase;
    room.tickCounter++;
    stepSimulation(room.match, room.inputs, FIXED_DT);

    if (room.match.events.length > 0) {
      room.pendingEvents.push(...room.match.events);
      room.match.events = [];
    }

    // Consume latched one-shot edge triggers
    for (const inp of room.inputs.values()) {
      inp.jumpJustPressed = false;
      inp.dashJustPressed = false;
      inp.useItem = false;
    }

    // Broadcast at 30Hz, or immediately if any events occurred or phase changed
    if (
      room.pendingEvents.length > 0 ||
      room.tickCounter % 2 === 0 ||
      room.match.phase !== prevPhase
    ) {
      sendSnapshot(room);
    }
  }, 1000 / TICK_RATE);
}

function removeClientFromRoom(client: ClientConn): void {
  if (!client.roomCode) return;
  const room = rooms.get(client.roomCode);
  client.roomCode = null;
  if (!room) return;

  room.clients.delete(client.id);
  room.inputs.delete(client.id);

  if (room.clients.size === 0) {
    if (room.interval) {
      clearInterval(room.interval);
      room.interval = null;
    }
    rooms.delete(room.code);
    broadcastRoomsList();
    return;
  }

  if (room.hostId === client.id) {
    const nextHost = room.clients.values().next().value;
    if (nextHost) {
      room.hostId = nextHost.id;
    }
  }

  if (room.match.phase === 'lobby') {
    rebuildRoomRobots(room, false);
  } else {
    room.match.robots = room.match.robots.filter((r) => r.id !== client.id);
    if (room.match.phase === 'editor_build' && room.match.editorState) {
      room.match.editorState.creators = room.match.editorState.creators.filter(
        (c) => c.playerId !== client.id
      );
      const allHumansSubmitted = room.match.editorState.creators
        .filter((c) => !c.isBot)
        .every((c) => c.submitted);
      if (allHumansSubmitted && room.clients.size > 0) {
        compileEditorPlaylistAndStart(room);
        return;
      }
    }
  }

  sendSnapshot(room);
  broadcastRoomsList();
}

function createRoomForClient(
  client: ClientConn,
  botCount: number,
  quickStart: boolean,
  gameMode: GameMode,
  initialSettings?: Partial<MatchSettings>
): Room {
  removeClientFromRoom(client);

  const code = randomRoomCode();
  const seed = Math.floor(Math.random() * 1_000_000_000);
  const matchSettings = sanitizeMatchSettings(initialSettings, DEFAULT_MATCH_SETTINGS);
  const stage =
    gameMode === 'editor'
      ? createBlankEditorStage(1, 'foundry', seed)
      : generateStage(1, seed, matchSettings);
  const clampedBots = Math.max(0, Math.min(9, Math.floor(botCount)));

  const room: Room = {
    code,
    hostId: client.id,
    gameMode,
    matchSettings,
    seed,
    botCount: clampedBots,
    clients: new Map([[client.id, client]]),
    inputs: new Map([
      [
        client.id,
        {
          left: false,
          right: false,
          jump: false,
          jumpJustPressed: false,
          dashJustPressed: false,
          useItem: false,
        },
      ],
    ]),
    match: {
      roomCode: code,
      gameMode,
      matchSettings,
      stageNumber: 1,
      phase: 'lobby',
      countdownTimer: 0,
      raceTime: 0,
      stage,
      robots: [],
      projectiles: [],
      traps: [],
      events: [],
      nextEntityId: 1000,
      podiumAutoTimer: 0,
    },
    customMaps: new Map(),
    mapPlaylist: [],
    pendingEvents: [],
    tickCounter: 0,
    interval: null,
  };

  client.roomCode = code;
  rooms.set(code, room);
  rebuildRoomRobots(room, false);

  sendMsg(client.ws, {
    type: 'room_joined',
    roomCode: code,
    hostId: room.hostId,
    botCount: room.botCount,
    gameMode: room.gameMode,
    matchSettings: room.matchSettings,
    state: room.match,
  });

  ensureRoomLoop(room);

  if (quickStart) {
    if (gameMode === 'editor') {
      startEditorBuildPhaseInRoom(room);
    } else {
      startStageInRoom(room, 1, false);
    }
  }

  broadcastRoomsList();
  return room;
}

async function bootstrapServer() {
  const app = express();
  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, rooms: rooms.size, players: clients.size });
  });

  app.get('/api/rooms', (_req, res) => {
    res.json({ rooms: getRoomSummaries() });
  });

  wss.on('connection', (ws) => {
    const id = `p_${clientSeq++}_${Math.random().toString(36).slice(2, 6)}`;
    const client: ClientConn = {
      id,
      ws,
      name: `Robô ${clientSeq - 1}`,
      colorIndex: (clientSeq - 1) % ROBOT_PALETTES.length,
      robotClass: 'balanced',
      roomCode: null,
    };
    clients.set(id, client);

    sendMsg(ws, { type: 'welcome', playerId: id });
    sendMsg(ws, { type: 'rooms_list', rooms: getRoomSummaries() });

    ws.on('message', (raw) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }

      switch (msg.type) {
        case 'list_rooms': {
          sendMsg(ws, { type: 'rooms_list', rooms: getRoomSummaries() });
          break;
        }
        case 'create_room': {
          client.name = sanitizeName(msg.playerName);
          client.colorIndex = sanitizeColorIndex(msg.colorIndex);
          client.robotClass = sanitizeRobotClass(msg.robotClass);
          const gameMode = sanitizeGameMode(msg.gameMode);
          createRoomForClient(
            client,
            sanitizeBotCount(msg.botCount ?? 3, 9),
            Boolean(msg.quickStart),
            gameMode,
            msg.matchSettings
          );
          break;
        }
        case 'join_room': {
          const code = String(msg.roomCode || '').trim().toUpperCase();
          const room = rooms.get(code);
          if (!room) {
            sendMsg(ws, { type: 'error', message: `Sala "${code}" não encontrada.` });
            return;
          }
          if (room.clients.size >= MAX_PLAYERS_PER_ROOM) {
            sendMsg(ws, { type: 'error', message: 'Sala lotada (máximo 10 jogadores).' });
            return;
          }
          removeClientFromRoom(client);
          client.name = sanitizeName(msg.playerName);
          client.colorIndex = sanitizeColorIndex(msg.colorIndex);
          client.robotClass = sanitizeRobotClass(msg.robotClass);
          client.roomCode = code;
          room.clients.set(client.id, client);
          room.inputs.set(client.id, {
            left: false,
            right: false,
            jump: false,
            jumpJustPressed: false,
            dashJustPressed: false,
            useItem: false,
          });

          const maxBotsAllowed = MAX_PLAYERS_PER_ROOM - room.clients.size;
          if (room.botCount > maxBotsAllowed) {
            room.botCount = maxBotsAllowed;
          }

          if (room.match.phase === 'lobby') {
            rebuildRoomRobots(room, false);
          } else {
            const botIdx = room.match.robots.findIndex((r) => r.isBot);
            if (botIdx >= 0 && room.match.robots.length >= MAX_PLAYERS_PER_ROOM) {
              room.match.robots.splice(botIdx, 1);
            }
            room.match.robots.push(
              createRobotState({
                id: client.id,
                name: client.name,
                colorIndex: client.colorIndex,
                robotClass: client.robotClass,
                isBot: false,
                stage: room.match.stage,
                spawnSlot: room.match.robots.length,
              })
            );
            if (room.match.phase === 'editor_build' && room.match.editorState) {
              room.match.editorState.creators.push({
                playerId: client.id,
                playerName: client.name,
                colorIndex: client.colorIndex,
                isBot: false,
                validated: false,
                submitted: false,
                objectCount: countEditorStageObjects(room.match.stage),
                creatorBestTime: null,
              });
              room.match.editorState.totalMaps = room.match.editorState.creators.length;
            }
          }

          sendMsg(ws, {
            type: 'room_joined',
            roomCode: code,
            hostId: room.hostId,
            botCount: room.botCount,
            gameMode: room.gameMode,
            matchSettings: room.matchSettings,
            state: room.match,
          });
          sendSnapshot(room);
          broadcastRoomsList();
          break;
        }
        case 'update_profile': {
          client.name = sanitizeName(msg.playerName);
          client.colorIndex = sanitizeColorIndex(msg.colorIndex);
          if (msg.robotClass) client.robotClass = sanitizeRobotClass(msg.robotClass);
          if (client.roomCode) {
            const room = rooms.get(client.roomCode);
            if (room) {
              const robot = room.match.robots.find((r) => r.id === client.id);
              if (robot) {
                robot.name = client.name;
                robot.colorIndex = client.colorIndex;
                if (room.match.phase === 'lobby') {
                  robot.robotClass = client.robotClass;
                  robot.dashMaxCooldown = ROBOT_CLASSES[client.robotClass].dashCooldown;
                }
                sendSnapshot(room);
              }
              if (room.hostId === client.id) {
                broadcastRoomsList();
              }
            }
          }
          break;
        }
        case 'set_bot_count': {
          if (!client.roomCode) return;
          const room = rooms.get(client.roomCode);
          if (!room || room.hostId !== client.id) return;
          const maxBots = MAX_PLAYERS_PER_ROOM - room.clients.size;
          room.botCount = sanitizeBotCount(msg.botCount, maxBots);
          if (room.match.phase === 'lobby') {
            rebuildRoomRobots(room, false);
          }
          sendSnapshot(room);
          broadcastRoomsList();
          break;
        }
        case 'set_game_mode': {
          if (!client.roomCode) return;
          const room = rooms.get(client.roomCode);
          if (!room || room.hostId !== client.id) return;
          room.gameMode = sanitizeGameMode(msg.gameMode);
          room.match.gameMode = room.gameMode;
          sendSnapshot(room);
          broadcastRoomsList();
          break;
        }
        case 'update_match_settings': {
          if (!client.roomCode) return;
          const room = rooms.get(client.roomCode);
          if (!room || room.hostId !== client.id) return;
          room.matchSettings = sanitizeMatchSettings(msg.settings, room.matchSettings);
          room.match.matchSettings = room.matchSettings;
          if (room.match.editorState) {
            room.match.editorState.buildTimeLimit = room.matchSettings.editorBuildTimeLimit;
            room.match.editorState.courseTimeLimit = room.matchSettings.editorCourseTimeLimit;
            room.match.editorState.previewTimeLimit = room.matchSettings.editorPreviewSeconds;
          }
          sendSnapshot(room);
          broadcastRoomsList();
          break;
        }
        case 'start_race': {
          if (!client.roomCode) return;
          const room = rooms.get(client.roomCode);
          if (!room || room.hostId !== client.id) return;
          if (room.clients.size + room.botCount < 2) {
            sendMsg(ws, {
              type: 'error',
              message: 'São necessários pelo menos 2 competidores (jogadores ou robôs IA).',
            });
            return;
          }
          if (room.gameMode === 'editor') {
            startEditorBuildPhaseInRoom(room);
          } else {
            startStageInRoom(room, 1, false);
          }
          broadcastRoomsList();
          break;
        }
        case 'editor_status_update': {
          if (!client.roomCode) return;
          const room = rooms.get(client.roomCode);
          if (!room || room.match.phase !== 'editor_build' || !room.match.editorState) return;
          const creator = room.match.editorState.creators.find(
            (c) => c.playerId === client.id
          );
          if (creator && !creator.submitted) {
            creator.validated = Boolean(msg.validated);
            creator.objectCount = Math.max(0, Number(msg.objectCount) || 0);
            creator.creatorBestTime =
              typeof msg.creatorBestTime === 'number' ? msg.creatorBestTime : null;
            sendSnapshot(room);
          }
          break;
        }
        case 'submit_custom_map': {
          if (!client.roomCode) return;
          const room = rooms.get(client.roomCode);
          if (!room || room.match.phase !== 'editor_build' || !room.match.editorState) return;

          const cleanStage = sanitizeSubmittedStage(msg.stage, 1);
          const bestTime =
            typeof msg.creatorBestTime === 'number' && msg.creatorBestTime > 0
              ? Number(msg.creatorBestTime.toFixed(2))
              : 10.0;
          const title =
            String(msg.title ?? '').trim().slice(0, 28) || `Mapa de ${client.name}`;
          const courseLimit =
            room.matchSettings.editorCourseTimeLimit || EDITOR_COURSE_TIME_LIMIT;

          const entry: CustomMapEntry = {
            creatorId: client.id,
            creatorName: client.name,
            creatorColorIndex: client.colorIndex,
            title,
            stage: cleanStage,
            validated: true,
            creatorBestTime: bestTime,
            courseTimeLimit: courseLimit,
          };

          room.customMaps.set(client.id, entry);

          const creator = room.match.editorState.creators.find(
            (c) => c.playerId === client.id
          );
          if (creator) {
            creator.validated = true;
            creator.submitted = true;
            creator.objectCount = countEditorStageObjects(cleanStage);
            creator.creatorBestTime = bestTime;
          }

          const allHumansSubmitted = room.match.editorState.creators
            .filter((c) => !c.isBot)
            .every((c) => c.submitted);

          if (allHumansSubmitted) {
            compileEditorPlaylistAndStart(room);
            broadcastRoomsList();
          } else {
            sendSnapshot(room);
          }
          break;
        }
        case 'skip_map_preview': {
          if (!client.roomCode) return;
          const room = rooms.get(client.roomCode);
          if (!room || room.match.phase !== 'map_preview') return;
          room.match.raceTime = 0;
          room.match.phase = 'countdown';
          room.match.countdownTimer = 1.8;
          sendSnapshot(room);
          break;
        }
        case 'next_stage': {
          if (!client.roomCode) return;
          const room = rooms.get(client.roomCode);
          if (!room || room.hostId !== client.id) return;

          if (room.gameMode === 'editor' && room.match.editorState) {
            const nextMapIdx = room.match.editorState.currentMapIndex + 1;
            if (nextMapIdx < room.mapPlaylist.length) {
              startEditorPlaylistMap(room, nextMapIdx, true);
            } else {
              // All maps have been played -> start a brand-new Editor Mode cycle!
              startEditorBuildPhaseInRoom(room);
            }
          } else {
            const targetStages = room.matchSettings.classicTargetStages ?? 0;
            if (targetStages > 0 && room.match.stageNumber >= targetStages) {
              // Classic tournament reached target stages -> start a fresh tournament at Stage 1
              startStageInRoom(room, 1, false);
            } else {
              startStageInRoom(room, room.match.stageNumber + 1, true);
            }
          }
          broadcastRoomsList();
          break;
        }
        case 'restart_editor_cycle': {
          if (!client.roomCode) return;
          const room = rooms.get(client.roomCode);
          if (!room || room.hostId !== client.id) return;
          startEditorBuildPhaseInRoom(room);
          broadcastRoomsList();
          break;
        }
        case 'return_lobby': {
          if (!client.roomCode) return;
          const room = rooms.get(client.roomCode);
          if (!room || room.hostId !== client.id) return;
          room.match.phase = 'lobby';
          room.match.stageNumber = 1;
          room.match.stage = generateStage(
            1,
            Math.floor(Math.random() * 1_000_000_000),
            room.matchSettings
          );
          rebuildRoomRobots(room, false);
          broadcastToRoom(room, {
            type: 'stage_loaded',
            stage: room.match.stage,
            stageNumber: 1,
            hostId: room.hostId,
            botCount: room.botCount,
            gameMode: room.gameMode,
            matchSettings: room.matchSettings,
            editorState: room.match.editorState,
          });
          sendSnapshot(room);
          broadcastRoomsList();
          break;
        }
        case 'leave_room': {
          removeClientFromRoom(client);
          sendMsg(ws, { type: 'rooms_list', rooms: getRoomSummaries() });
          break;
        }
        case 'input': {
          if (!client.roomCode) return;
          const room = rooms.get(client.roomCode);
          if (!room) return;
          const prev = room.inputs.get(client.id);
          room.inputs.set(client.id, {
            left: Boolean(msg.left),
            right: Boolean(msg.right),
            down: Boolean(msg.down),
            jump: Boolean(msg.jump),
            jumpJustPressed: Boolean(prev?.jumpJustPressed || msg.jumpJustPressed),
            dashJustPressed: Boolean(prev?.dashJustPressed || msg.dashJustPressed),
            useItem: Boolean(prev?.useItem || msg.useItem),
          });
          break;
        }
      }
    });

    ws.on('close', () => {
      removeClientFromRoom(client);
      clients.delete(id);
    });
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const PORT = 3000;
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Robo Sprint multiplayer server running at http://localhost:${PORT}`);
  });
}

bootstrapServer();
