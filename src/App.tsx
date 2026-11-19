import React, { useCallback, useEffect, useRef, useState } from 'react';
import { GameHud } from './components/GameHud';
import { PauseModal, PodiumModal } from './components/GameModals';
import { MapEditorView } from './components/MapEditorView';
import { TitleLobby } from './components/TitleLobby';
import { soundEngine } from './game/audio';
import { DEFAULT_MATCH_SETTINGS, ITEM_METADATA } from './game/constants';
import { EDITOR_MAP_PREVIEW_TIME } from './game/editor';
import {
  applyWheelZoom,
  CAMERA_DEFAULT_ZOOM,
  clampCameraZoom,
  createGamepadMemoryState,
  cycleCameraZoomLevel,
  pollBrowserGamepads,
  stepCameraZoomLevel,
} from './game/gamepad';
import { updateStageDynamics } from './game/physics';
import { GameRenderer } from './game/renderer';
import type {
  ActiveTrap,
  ClientMessage,
  EditorModeState,
  GameEvent,
  GameMode,
  MatchSettings,
  MatchState,
  Projectile,
  RobotClassId,
  RobotState,
  RoomSummary,
  ServerMessage,
  StageData,
} from './game/types';

type AppScreenState = 'title' | 'lobby' | 'playing' | 'paused' | 'gameover';

interface HudSnapshot {
  stage: StageData | null;
  robots: RobotState[];
  raceTime: number;
  countdownTimer: number;
  phase: MatchState['phase'];
  hostId: string | null;
  botCount: number;
  gameMode: GameMode;
  matchSettings: MatchSettings;
  editorState?: EditorModeState;
  previewCamera?: { x: number; y: number; zoom: number; mode: 'auto_tour' | 'free' };
}

function computeStageOverviewCamera(
  stage: StageData,
  viewW = 1280,
  viewH = 800
): { x: number; y: number; zoom: number } {
  let minX = Math.min(stage.startX, stage.finishX);
  let maxX = Math.max(stage.startX + 120, stage.finishX + stage.finishW);
  let minY = Math.min(stage.startY, stage.finishY);
  let maxY = Math.max(stage.startY + 40, stage.finishY + stage.finishH);

  for (const p of stage.platforms) {
    minX = Math.min(minX, p.baseX);
    maxX = Math.max(maxX, p.baseX + p.w);
    minY = Math.min(minY, p.baseY);
    maxY = Math.max(maxY, p.baseY + p.h);
  }

  const spanW = Math.max(480, maxX - minX + 260);
  const spanH = Math.max(320, maxY - minY + 260);
  const fitZoom = clampCameraZoom(
    Math.min((viewW * 0.82) / spanW, (viewH * 0.72) / spanH, 1.15)
  );
  return {
    x: Math.round((minX + maxX) * 0.5),
    y: Math.round((minY + maxY) * 0.5),
    zoom: fitZoom,
  };
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<GameRenderer>(new GameRenderer());
  const wsRef = useRef<WebSocket | null>(null);

  // Live simulation data read by 60fps requestAnimationFrame without triggering React renders
  const simRef = useRef<{
    playerId: string;
    roomCode: string | null;
    hostId: string | null;
    botCount: number;
    gameMode: GameMode;
    matchSettings: MatchSettings;
    editorState?: EditorModeState;
    phase: MatchState['phase'];
    stage: StageData | null;
    robots: RobotState[];
    projectiles: Projectile[];
    traps: ActiveTrap[];
    raceTime: number;
    countdownTimer: number;
    lastSnapshotPerf: number;
  }>({
    playerId: '',
    roomCode: null,
    hostId: null,
    botCount: 3,
    gameMode: 'classic',
    matchSettings: DEFAULT_MATCH_SETTINGS,
    editorState: undefined,
    phase: 'lobby',
    stage: null,
    robots: [],
    projectiles: [],
    traps: [],
    raceTime: 0,
    countdownTimer: 0,
    lastSnapshotPerf: 0,
  });

  // Input state ref
  const inputRef = useRef({
    keys: new Set<string>(),
    touchLeft: false,
    touchRight: false,
    touchJump: false,
    prevJump: false,
    pendingJumpJustPressed: false,
    pendingDashJustPressed: false,
    pendingUseItem: false,
  });

  const [screen, setScreen] = useState<AppScreenState>('title');
  const screenRef = useRef<AppScreenState>('title');
  screenRef.current = screen;

  const [connected, setConnected] = useState(false);
  const [playerId, setPlayerId] = useState('');
  const [playerName, setPlayerName] = useState('Robo-1');
  const [colorIndex, setColorIndex] = useState(0);
  const [robotClass, setRobotClass] = useState<RobotClassId>('balanced');
  const profileRef = useRef<{
    playerName: string;
    colorIndex: number;
    robotClass: RobotClassId;
  }>({
    playerName: 'Robo-1',
    colorIndex: 0,
    robotClass: 'balanced',
  });
  profileRef.current = { playerName, colorIndex, robotClass };
  const [openRooms, setOpenRooms] = useState<RoomSummary[]>([]);
  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [cameraZoom, setCameraZoom] = useState(CAMERA_DEFAULT_ZOOM);
  const cameraZoomRef = useRef(CAMERA_DEFAULT_ZOOM);
  const [gamepadConnected, setGamepadConnected] = useState(false);
  const gamepadConnectedRef = useRef(false);
  const gamepadMemRef = useRef(createGamepadMemoryState());
  const [feedText, setFeedText] = useState<string | null>(null);
  const feedTimerRef = useRef<number | null>(null);

  const previewCamRef = useRef<{
    x: number;
    y: number;
    zoom: number;
    mode: 'auto_tour' | 'free';
    dragging: boolean;
    lastClientX: number;
    lastClientY: number;
  }>({
    x: 340,
    y: -60,
    zoom: 0.9,
    mode: 'auto_tour',
    dragging: false,
    lastClientX: 0,
    lastClientY: 0,
  });

  const applyCameraZoom = useCallback((nextZoom: number) => {
    const clamped = clampCameraZoom(nextZoom);
    if (simRef.current.phase === 'map_preview') {
      previewCamRef.current.zoom = clamped;
      rendererRef.current.setZoom(clamped);
      setCameraZoom(clamped);
      return;
    }
    cameraZoomRef.current = clamped;
    rendererRef.current.setZoom(clamped);
    setCameraZoom(clamped);
  }, []);

  const handleCycleZoom = useCallback(() => {
    const baseZoom =
      simRef.current.phase === 'map_preview'
        ? previewCamRef.current.zoom
        : cameraZoomRef.current;
    applyCameraZoom(cycleCameraZoomLevel(baseZoom));
  }, [applyCameraZoom]);

  const handleZoomIn = useCallback(() => {
    const baseZoom =
      simRef.current.phase === 'map_preview'
        ? previewCamRef.current.zoom
        : cameraZoomRef.current;
    applyCameraZoom(stepCameraZoomLevel(baseZoom, 1));
  }, [applyCameraZoom]);

  const handleZoomOut = useCallback(() => {
    const baseZoom =
      simRef.current.phase === 'map_preview'
        ? previewCamRef.current.zoom
        : cameraZoomRef.current;
    applyCameraZoom(stepCameraZoomLevel(baseZoom, -1));
  }, [applyCameraZoom]);

  const handleCanvasWheel = useCallback(
    (e: React.WheelEvent<HTMLCanvasElement>) => {
      if (screenRef.current !== 'playing' && screenRef.current !== 'paused') return;
      const baseZoom =
        simRef.current.phase === 'map_preview'
          ? previewCamRef.current.zoom
          : cameraZoomRef.current;
      const next = applyWheelZoom(baseZoom, e.deltaY);
      applyCameraZoom(next);
    },
    [applyCameraZoom]
  );

  const handleCanvasPointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (simRef.current.phase !== 'map_preview') return;
      if (e.button === 0 || e.button === 1 || e.button === 2) {
        e.preventDefault();
        previewCamRef.current.mode = 'free';
        previewCamRef.current.dragging = true;
        previewCamRef.current.lastClientX = e.clientX;
        previewCamRef.current.lastClientY = e.clientY;
      }
    },
    []
  );

  const handleCanvasPointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (simRef.current.phase !== 'map_preview' || !previewCamRef.current.dragging) {
        return;
      }
      const dx = e.clientX - previewCamRef.current.lastClientX;
      const dy = e.clientY - previewCamRef.current.lastClientY;
      previewCamRef.current.lastClientX = e.clientX;
      previewCamRef.current.lastClientY = e.clientY;
      const z = Math.max(0.55, previewCamRef.current.zoom);
      previewCamRef.current.x -= dx / z;
      previewCamRef.current.y -= dy / z;
    },
    []
  );

  const handleCanvasPointerUp = useCallback(() => {
    previewCamRef.current.dragging = false;
  }, []);

  const handlePreviewFitMap = useCallback(() => {
    const stage = simRef.current.stage;
    if (!stage) return;
    const fit = computeStageOverviewCamera(
      stage,
      window.innerWidth || 1280,
      window.innerHeight || 800
    );
    previewCamRef.current.mode = 'free';
    previewCamRef.current.x = fit.x;
    previewCamRef.current.y = fit.y;
    previewCamRef.current.zoom = fit.zoom;
    rendererRef.current.setCameraDirectly(fit.x, fit.y, fit.zoom);
    setCameraZoom(fit.zoom);
  }, []);

  const handlePreviewFocusStart = useCallback(() => {
    const stage = simRef.current.stage;
    if (!stage) return;
    previewCamRef.current.mode = 'free';
    previewCamRef.current.x = stage.startX + 40;
    previewCamRef.current.y = stage.startY - 24;
    previewCamRef.current.zoom = 1.15;
    rendererRef.current.setCameraDirectly(
      previewCamRef.current.x,
      previewCamRef.current.y,
      previewCamRef.current.zoom
    );
    setCameraZoom(previewCamRef.current.zoom);
  }, []);

  const handlePreviewFocusFinish = useCallback(() => {
    const stage = simRef.current.stage;
    if (!stage) return;
    previewCamRef.current.mode = 'free';
    previewCamRef.current.x = stage.finishX + stage.finishW * 0.5;
    previewCamRef.current.y = stage.finishY + stage.finishH * 0.5;
    previewCamRef.current.zoom = 1.15;
    rendererRef.current.setCameraDirectly(
      previewCamRef.current.x,
      previewCamRef.current.y,
      previewCamRef.current.zoom
    );
    setCameraZoom(previewCamRef.current.zoom);
  }, []);

  const handlePreviewAutoTour = useCallback(() => {
    previewCamRef.current.mode = 'auto_tour';
  }, []);

  const [hud, setHud] = useState<HudSnapshot>({
    stage: null,
    robots: [],
    raceTime: 0,
    countdownTimer: 0,
    phase: 'lobby',
    hostId: null,
    botCount: 3,
    gameMode: 'classic',
    matchSettings: DEFAULT_MATCH_SETTINGS,
    editorState: undefined,
  });

  const autoStartHandledRef = useRef(false);
  const queryParamsRef = useRef<{
    autostart: boolean;
    mode: GameMode;
    room: string | null;
  }>({
    autostart: false,
    mode: 'classic',
    room: null,
  });

  if (typeof window !== 'undefined' && !autoStartHandledRef.current) {
    const params = new URLSearchParams(window.location.search);
    queryParamsRef.current = {
      autostart: params.get('autostart') === '1',
      mode: params.get('mode') === 'editor' ? 'editor' : 'classic',
      room: params.get('room')?.trim().toUpperCase() || null,
    };
  }

  // Mirror state to document.body.dataset.state
  useEffect(() => {
    const bodyState = screen === 'lobby' ? 'title' : screen;
    document.body.dataset.state = bodyState;
  }, [screen]);

  const sendWs = useCallback((msg: ClientMessage) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }, []);

  const pushFeedText = useCallback((text: string) => {
    setFeedText(text);
    if (feedTimerRef.current !== null) {
      window.clearTimeout(feedTimerRef.current);
    }
    feedTimerRef.current = window.setTimeout(() => {
      setFeedText(null);
      feedTimerRef.current = null;
    }, 2600);
  }, []);

  const handleEventsFeedback = useCallback(
    (events: GameEvent[], myId: string) => {
      for (const ev of events) {
        switch (ev.type) {
          case 'jump':
            if (ev.actorId === myId) soundEngine.playJump();
            break;
          case 'dash':
            if (ev.actorId === myId) soundEngine.playDash();
            break;
          case 'spring':
            if (ev.actorId === myId) soundEngine.playSpring();
            break;
          case 'pickup':
            if (ev.actorId === myId) {
              soundEngine.playPickup();
              if (ev.itemType && ITEM_METADATA[ev.itemType]) {
                pushFeedText(`Item coletado: ${ITEM_METADATA[ev.itemType].name}`);
              }
            }
            break;
          case 'turbo':
            soundEngine.playTurbo();
            if (ev.actorId === myId) pushFeedText('Turbo Overdrive ativado!');
            break;
          case 'shield':
            soundEngine.playShield();
            if (ev.actorId === myId) pushFeedText('Escudo Magnético ativo!');
            break;
          case 'emp':
            soundEngine.playEmp();
            pushFeedText(`${ev.actorName ?? 'Rival'} disparou Pulso EMP!`);
            break;
          case 'rocket_launch':
            soundEngine.playRocket();
            if (ev.targetName) {
              pushFeedText(`${ev.actorName ?? 'Rival'} lançou míssil em ${ev.targetName}!`);
            }
            break;
          case 'frost_drop':
            soundEngine.playFrost();
            break;
          case 'frost_hit':
            soundEngine.playFrost();
            pushFeedText(`${ev.actorName ?? 'Um robô'} congelou na mina!`);
            break;
          case 'barrier_drop':
            soundEngine.playBarrier();
            if (ev.actorId === myId) pushFeedText('Barreira Laser ativada na pista!');
            break;
          case 'barrier_hit':
            soundEngine.playBarrier();
            pushFeedText(`${ev.actorName ?? 'Um robô'} bateu na Barreira Laser!`);
            break;
          case 'grease_drop':
            soundEngine.playGrease();
            if (ev.actorId === myId) pushFeedText('Graxa espalhada no chão!');
            break;
          case 'grease_hit':
            soundEngine.playGrease();
            pushFeedText(`${ev.actorName ?? 'Um robô'} derrapou na graxa!`);
            break;
          case 'whirlwind_drop':
            soundEngine.playWhirlwind();
            if (ev.actorId === myId) pushFeedText('Redemoinho ativado! Super impulso vertical!');
            break;
          case 'whirlwind_hit':
            soundEngine.playWhirlwind();
            pushFeedText(`${ev.actorName ?? 'Um robô'} foi lançado pro alto pelo Redemoinho!`);
            break;
          case 'jetpack':
            soundEngine.playJetpack();
            if (ev.actorId === myId) {
              pushFeedText('Jetpack ativado! Segure Pular para voar!');
            } else if (ev.actorName) {
              pushFeedText(`${ev.actorName} acionou o Propulsor Jetpack!`);
            }
            break;
          case 'magnet':
            soundEngine.playMagnet();
            if (ev.targetName) {
              pushFeedText(`${ev.actorName ?? 'Rival'} puxou ${ev.targetName} com Gancho!`);
            }
            break;
          case 'glitch':
            soundEngine.playGlitch();
            if (ev.targetId === myId) {
              pushFeedText('Vírus de Controle! Sua direção foi invertida!');
            } else if (ev.targetName) {
              pushFeedText(`${ev.actorName ?? 'Rival'} inverteu controles de ${ev.targetName}!`);
            }
            break;
          case 'warp':
            soundEngine.playWarp();
            if (ev.actorId === myId) pushFeedText('Salto Quântico executado!');
            break;
          case 'boost_ring':
            if (ev.actorId === myId) {
              soundEngine.playBoostRing();
              pushFeedText('Anel Propulsor! Impulso aéreo + Dash pronto!');
            }
            break;
          case 'bumper':
            if (ev.actorId === myId) {
              soundEngine.playBumper();
            }
            break;
          case 'crystal':
            if (ev.actorId === myId) {
              soundEngine.playCrystal();
            }
            break;
          case 'checkpoint':
            if (ev.actorId === myId) {
              soundEngine.playCheckpoint();
              pushFeedText('Checkpoint alcançado!');
            }
            break;
          case 'fall_reset':
            if (ev.actorId === myId) {
              soundEngine.playHurt();
              const sim = simRef.current;
              const myRobot = sim.robots.find((r) => r.id === myId);
              const startX = sim.stage?.startX ?? 100;
              const startY = sim.stage?.startY ?? 0;
              if (
                myRobot &&
                (myRobot.checkpointY < startY - 30 || myRobot.checkpointX > startX + 120)
              ) {
                pushFeedText('Queda! Voltando ao último Checkpoint');
              } else {
                pushFeedText('Queda! Voltando ao início da fase');
              }
            }
            break;
          case 'hurt':
          case 'rocket_hit':
            if (ev.actorId === myId) soundEngine.playHurt();
            if (ev.type === 'rocket_hit') {
              pushFeedText(`${ev.actorName ?? 'Um robô'} foi atingido por míssil!`);
            }
            break;
          case 'finish':
            if (ev.actorId === myId) soundEngine.playFinish();
            pushFeedText(`${ev.actorName ?? 'Competidor'} cruzou a chegada!`);
            break;
        }
      }
    },
    [pushFeedText]
  );

  // WebSocket Connection & Auto-Reconnect
  useEffect(() => {
    let disposed = false;
    let reconnectTimer: number | null = null;

    const connect = () => {
      if (disposed) return;
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${proto}//${window.location.host}/ws`);
      wsRef.current = ws;

      ws.onopen = () => {
        if (disposed) return;
        setConnected(true);
        setErrorMsg(null);
      };

      ws.onmessage = (event) => {
        let msg: ServerMessage;
        try {
          msg = JSON.parse(event.data);
        } catch {
          return;
        }

        const sim = simRef.current;

        switch (msg.type) {
          case 'welcome': {
            sim.playerId = msg.playerId;
            setPlayerId(msg.playerId);

            // Handle ?autostart=1 (&mode=editor) or ?room=XXXX on initial connect
            if (!autoStartHandledRef.current) {
              autoStartHandledRef.current = true;
              if (queryParamsRef.current.autostart) {
                ws.send(
                  JSON.stringify({
                    type: 'create_room',
                    playerName,
                    colorIndex,
                    robotClass,
                    botCount: 3,
                    quickStart: true,
                    gameMode: queryParamsRef.current.mode,
                  } satisfies ClientMessage)
                );
              } else if (queryParamsRef.current.room) {
                ws.send(
                  JSON.stringify({
                    type: 'join_room',
                    roomCode: queryParamsRef.current.room,
                    playerName,
                    colorIndex,
                    robotClass,
                  } satisfies ClientMessage)
                );
              }
            }
            break;
          }

          case 'rooms_list': {
            setOpenRooms(msg.rooms);
            break;
          }

          case 'room_joined': {
            sim.roomCode = msg.roomCode;
            sim.hostId = msg.hostId;
            sim.botCount = msg.botCount;
            sim.gameMode = msg.gameMode || 'classic';
            sim.matchSettings = msg.matchSettings || DEFAULT_MATCH_SETTINGS;
            sim.editorState = msg.state.editorState;
            sim.stage = msg.state.stage;
            sim.robots = msg.state.robots;
            sim.projectiles = msg.state.projectiles;
            sim.traps = msg.state.traps;
            sim.phase = msg.state.phase;
            sim.raceTime = msg.state.raceTime;
            sim.countdownTimer = msg.state.countdownTimer;
            sim.lastSnapshotPerf = performance.now();

            rendererRef.current.resetCamera(msg.state.stage.startX, msg.state.stage.startY - 30);
            setRoomCode(msg.roomCode);

            if (msg.state.phase === 'lobby') {
              setScreen('lobby');
            } else if (msg.state.phase === 'podium') {
              setScreen('gameover');
            } else {
              setScreen('playing');
            }

            setHud({
              stage: msg.state.stage,
              robots: msg.state.robots,
              raceTime: msg.state.raceTime,
              countdownTimer: msg.state.countdownTimer,
              phase: msg.state.phase,
              hostId: msg.hostId,
              botCount: msg.botCount,
              gameMode: sim.gameMode,
              matchSettings: sim.matchSettings,
              editorState: msg.state.editorState,
            });
            break;
          }

          case 'stage_loaded': {
            if (!sim.roomCode) break;
            sim.stage = msg.stage;
            sim.hostId = msg.hostId;
            sim.botCount = msg.botCount;
            if (msg.gameMode) sim.gameMode = msg.gameMode;
            if (msg.matchSettings) sim.matchSettings = msg.matchSettings;
            if (msg.editorState) sim.editorState = msg.editorState;
            sim.projectiles = [];
            sim.traps = [];
            setFeedText(null);

            const fit = computeStageOverviewCamera(
              msg.stage,
              window.innerWidth || 1280,
              window.innerHeight || 800
            );
            previewCamRef.current = {
              x: msg.stage.finishX + msg.stage.finishW * 0.5,
              y: msg.stage.finishY + msg.stage.finishH * 0.5,
              zoom: fit.zoom,
              mode: 'auto_tour',
              dragging: false,
              lastClientX: 0,
              lastClientY: 0,
            };
            rendererRef.current.resetCamera(msg.stage.startX, msg.stage.startY - 30);
            setHud((prev) => ({
              ...prev,
              stage: msg.stage,
              hostId: msg.hostId,
              botCount: msg.botCount,
              gameMode: msg.gameMode ?? prev.gameMode,
              matchSettings: msg.matchSettings ?? prev.matchSettings,
              editorState: msg.editorState ?? prev.editorState,
            }));
            break;
          }

          case 'state_snapshot': {
            // Ignore any in-flight snapshot after the player has left the room!
            if (!sim.roomCode) break;

            const prevPhase = sim.phase;
            sim.hostId = msg.hostId;
            sim.botCount = msg.botCount;
            if (msg.gameMode) sim.gameMode = msg.gameMode;
            if (msg.matchSettings) sim.matchSettings = msg.matchSettings;
            sim.editorState = msg.editorState;
            sim.phase = msg.phase;
            sim.raceTime = msg.raceTime;
            sim.countdownTimer = msg.countdownTimer;
            sim.robots = msg.robots;
            sim.projectiles = msg.projectiles;
            sim.traps = msg.traps;
            sim.lastSnapshotPerf = performance.now();

            // When transitioning from map_preview into countdown, restore gameplay camera & zoom at Start!
            if (prevPhase === 'map_preview' && msg.phase !== 'map_preview' && sim.stage) {
              rendererRef.current.setZoom(cameraZoomRef.current);
              setCameraZoom(cameraZoomRef.current);
              rendererRef.current.resetCamera(sim.stage.startX, sim.stage.startY - 30);
            }

            if (sim.stage) {
              sim.stage.itemBoxes = msg.itemBoxes;
              if (msg.collectedCrystalIds) {
                const collectedSet = new Set(msg.collectedCrystalIds);
                for (const c of sim.stage.crystals) {
                  c.respawnAt = collectedSet.has(c.id) ? msg.raceTime + 1 : 0;
                }
              }
              if (msg.crumblingStates && msg.crumblingStates.length > 0) {
                const byId = new Map(msg.crumblingStates.map((c) => [c.id, c.state]));
                for (const plat of sim.stage.platforms) {
                  const nextState = byId.get(plat.id);
                  if (nextState) plat.crumbleState = nextState;
                }
              }
              // Sync stage dynamics immediately to authoritative server raceTime
              updateStageDynamics(sim.stage, msg.raceTime);
            }

            const freshEvents = rendererRef.current.ingestEvents(msg.events, sim.playerId);
            if (freshEvents.length > 0) {
              handleEventsFeedback(freshEvents, sim.playerId);
            }

            if (msg.phase === 'lobby' && screenRef.current !== 'title') {
              setScreen('lobby');
              setHud({
                stage: sim.stage,
                robots: msg.robots,
                raceTime: msg.raceTime,
                countdownTimer: msg.countdownTimer,
                phase: msg.phase,
                hostId: msg.hostId,
                botCount: msg.botCount,
                gameMode: sim.gameMode,
                matchSettings: sim.matchSettings,
                editorState: msg.editorState,
              });
            } else if (msg.phase === 'editor_build') {
              if (screenRef.current !== 'playing') {
                setScreen('playing');
              }
              if (prevPhase !== 'editor_build') {
                setHud({
                  stage: sim.stage,
                  robots: msg.robots,
                  raceTime: msg.raceTime,
                  countdownTimer: msg.countdownTimer,
                  phase: msg.phase,
                  hostId: msg.hostId,
                  botCount: msg.botCount,
                  gameMode: sim.gameMode,
                  matchSettings: sim.matchSettings,
                  editorState: msg.editorState,
                });
              }
            } else if (msg.phase === 'podium') {
              setScreen('gameover');
              setHud({
                stage: sim.stage,
                robots: msg.robots,
                raceTime: msg.raceTime,
                countdownTimer: msg.countdownTimer,
                phase: msg.phase,
                hostId: msg.hostId,
                botCount: msg.botCount,
                gameMode: sim.gameMode,
                matchSettings: sim.matchSettings,
                editorState: msg.editorState,
              });
            } else if (
              (msg.phase === 'map_preview' ||
                msg.phase === 'countdown' ||
                msg.phase === 'racing') &&
              (prevPhase === 'lobby' ||
                prevPhase === 'editor_build' ||
                prevPhase === 'map_preview' ||
                prevPhase === 'podium' ||
                screenRef.current === 'lobby' ||
                screenRef.current === 'gameover')
            ) {
              if (document.activeElement instanceof HTMLElement) {
                document.activeElement.blur();
              }
              setScreen('playing');
              setHud({
                stage: sim.stage,
                robots: msg.robots,
                raceTime: msg.raceTime,
                countdownTimer: msg.countdownTimer,
                phase: msg.phase,
                hostId: msg.hostId,
                botCount: msg.botCount,
                gameMode: sim.gameMode,
                matchSettings: sim.matchSettings,
                editorState: msg.editorState,
                previewCamera:
                  msg.phase === 'map_preview'
                    ? {
                        x: previewCamRef.current.x,
                        y: previewCamRef.current.y,
                        zoom: previewCamRef.current.zoom,
                        mode: previewCamRef.current.mode,
                      }
                    : undefined,
              });
            }
            break;
          }

          case 'error': {
            setErrorMsg(msg.message);
            break;
          }
        }
      };

      ws.onclose = () => {
        if (disposed) return;
        setConnected(false);
        reconnectTimer = window.setTimeout(connect, 1500);
      };
    };

    connect();

    return () => {
      disposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (feedTimerRef.current !== null) clearTimeout(feedTimerRef.current);
      wsRef.current?.close();
    };
  }, [handleEventsFeedback]);

  // Throttled HUD React state sync during active racing/countdown/map_preview/editor_build
  useEffect(() => {
    const id = window.setInterval(() => {
      const sim = simRef.current;
      if (!sim.roomCode) return;
      if (
        sim.phase !== 'map_preview' &&
        sim.phase !== 'countdown' &&
        sim.phase !== 'racing' &&
        sim.phase !== 'editor_build'
      ) {
        return;
      }
      setHud({
        stage: sim.stage,
        robots: sim.robots,
        raceTime: sim.raceTime,
        countdownTimer: sim.countdownTimer,
        phase: sim.phase,
        hostId: sim.hostId,
        botCount: sim.botCount,
        gameMode: sim.gameMode,
        matchSettings: sim.matchSettings,
        editorState: sim.editorState,
        previewCamera:
          sim.phase === 'map_preview'
            ? {
                x: previewCamRef.current.x,
                y: previewCamRef.current.y,
                zoom: previewCamRef.current.zoom,
                mode: previewCamRef.current.mode,
              }
            : undefined,
      });
    }, 150);
    return () => clearInterval(id);
  }, []);

  // Input transmission loop (~30Hz + immediate on edge triggers) + Gamepad polling
  const flushInput = useCallback(() => {
    const sim = simRef.current;

    // When Editor Build Mode is active, MapEditorView handles gamepad polling directly
    if (sim.phase === 'editor_build' && screenRef.current !== 'title') {
      return;
    }

    const gp = pollBrowserGamepads(gamepadMemRef.current);
    if (gp.connected !== gamepadConnectedRef.current) {
      gamepadConnectedRef.current = gp.connected;
      setGamepadConnected(gp.connected);
      if (gp.connected) {
        pushFeedText('Controle Gamepad conectado!');
      }
    }

    if (gp.connected) {
      // Allow starting a quick match from the Title screen via Gamepad Start or A button
      if (
        screenRef.current === 'title' &&
        (gp.pauseJustPressed || gp.primaryActionJustPressed)
      ) {
        const ws = wsRef.current;
        if (ws && ws.readyState === WebSocket.OPEN) {
          const p = profileRef.current;
          ws.send(
            JSON.stringify({
              type: 'create_room',
              playerName: p.playerName,
              colorIndex: p.colorIndex,
              robotClass: p.robotClass,
              botCount: 3,
              quickStart: true,
              gameMode: 'classic',
            } satisfies ClientMessage)
          );
        }
        return;
      }

      // Gamepad Start toggles Pause during race
      if (gp.pauseJustPressed) {
        if (screenRef.current === 'playing') {
          setScreen('paused');
          return;
        }
        if (screenRef.current === 'paused') {
          setScreen('playing');
          return;
        }
      }

      // Right stick vertical or R3 adjusts camera zoom
      if (screenRef.current === 'playing' || screenRef.current === 'paused') {
        if (gp.zoomCycleJustPressed) {
          applyCameraZoom(cycleCameraZoomLevel(cameraZoomRef.current));
        } else if (gp.zoomDelta !== 0) {
          applyCameraZoom(cameraZoomRef.current + gp.zoomDelta * 0.045);
        }
      }
    }

    if (!sim.roomCode || (sim.phase !== 'racing' && sim.phase !== 'countdown')) return;
    if (screenRef.current === 'paused') return;

    const inp = inputRef.current;
    const keys = inp.keys;
    const left = keys.has('ArrowLeft') || keys.has('KeyA') || inp.touchLeft || gp.left;
    const right = keys.has('ArrowRight') || keys.has('KeyD') || inp.touchRight || gp.right;
    const down = keys.has('ArrowDown') || keys.has('KeyS') || gp.down;
    const jump =
      keys.has('Space') ||
      keys.has('ArrowUp') ||
      keys.has('KeyW') ||
      inp.touchJump ||
      gp.jump;

    const jumpJustPressed =
      inp.pendingJumpJustPressed || gp.jumpJustPressed || (jump && !inp.prevJump);
    inp.prevJump = jump;
    const dashJustPressed = inp.pendingDashJustPressed || gp.dashJustPressed;
    const useItem = inp.pendingUseItem || gp.useItemJustPressed;
    inp.pendingJumpJustPressed = false;
    inp.pendingDashJustPressed = false;
    inp.pendingUseItem = false;

    sendWs({
      type: 'input',
      left,
      right,
      down,
      jump,
      jumpJustPressed,
      dashJustPressed,
      useItem,
    });
  }, [applyCameraZoom, pushFeedText, sendWs]);

  const clearAndStopInput = useCallback(() => {
    inputRef.current.keys.clear();
    inputRef.current.touchLeft = false;
    inputRef.current.touchRight = false;
    inputRef.current.touchJump = false;
    inputRef.current.prevJump = false;
    inputRef.current.pendingJumpJustPressed = false;
    inputRef.current.pendingDashJustPressed = false;
    inputRef.current.pendingUseItem = false;
    const sim = simRef.current;
    if (sim.roomCode && (sim.phase === 'racing' || sim.phase === 'countdown')) {
      sendWs({
        type: 'input',
        left: false,
        right: false,
        down: false,
        jump: false,
        jumpJustPressed: false,
        dashJustPressed: false,
        useItem: false,
      });
    }
  }, [sendWs]);

  useEffect(() => {
    const id = window.setInterval(flushInput, 33);
    return () => clearInterval(id);
  }, [flushInput]);

  useEffect(() => {
    const onGamepadConnected = () => {
      gamepadConnectedRef.current = true;
      setGamepadConnected(true);
      pushFeedText('Controle Gamepad conectado!');
    };
    const onGamepadDisconnected = () => {
      const gp = pollBrowserGamepads(gamepadMemRef.current);
      gamepadConnectedRef.current = gp.connected;
      setGamepadConnected(gp.connected);
    };
    window.addEventListener('gamepadconnected', onGamepadConnected);
    window.addEventListener('gamepaddisconnected', onGamepadDisconnected);
    return () => {
      window.removeEventListener('gamepadconnected', onGamepadConnected);
      window.removeEventListener('gamepaddisconnected', onGamepadDisconnected);
    };
  }, [pushFeedText]);

  // Actions
  const handleQuickStart = useCallback(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    inputRef.current.keys.clear();
    setErrorMsg(null);
    const p = profileRef.current;
    sendWs({
      type: 'create_room',
      playerName: p.playerName,
      colorIndex: p.colorIndex,
      robotClass: p.robotClass,
      botCount: 3,
      quickStart: true,
      gameMode: 'classic',
    });
  }, [sendWs]);

  const handleStartEditorMode = useCallback(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    inputRef.current.keys.clear();
    setErrorMsg(null);
    const p = profileRef.current;
    sendWs({
      type: 'create_room',
      playerName: p.playerName,
      colorIndex: p.colorIndex,
      robotClass: p.robotClass,
      botCount: 3,
      quickStart: true,
      gameMode: 'editor',
    });
  }, [sendWs]);

  const handleCreateRoom = useCallback(() => {
    setErrorMsg(null);
    const p = profileRef.current;
    sendWs({
      type: 'create_room',
      playerName: p.playerName,
      colorIndex: p.colorIndex,
      robotClass: p.robotClass,
      botCount: 0,
      quickStart: false,
      gameMode: 'classic',
    });
  }, [sendWs]);

  const handleJoinRoom = useCallback(
    (code: string) => {
      setErrorMsg(null);
      const p = profileRef.current;
      sendWs({
        type: 'join_room',
        roomCode: code,
        playerName: p.playerName,
        colorIndex: p.colorIndex,
        robotClass: p.robotClass,
      });
    },
    [sendWs]
  );

  const handleLeaveRoom = useCallback(() => {
    clearAndStopInput();
    sendWs({ type: 'leave_room' });
    simRef.current.roomCode = null;
    simRef.current.stage = null;
    simRef.current.robots = [];
    simRef.current.projectiles = [];
    simRef.current.traps = [];
    simRef.current.phase = 'lobby';
    screenRef.current = 'title';
    setFeedText(null);
    setRoomCode(null);
    setHud((prev) => ({
      ...prev,
      stage: null,
      robots: [],
      raceTime: 0,
      countdownTimer: 0,
      phase: 'lobby',
      hostId: null,
    }));
    setScreen('title');
    sendWs({ type: 'list_rooms' });
  }, [clearAndStopInput, sendWs]);

  const handleToggleMute = useCallback(() => {
    const next = !soundEngine.isMuted();
    soundEngine.setMuted(next);
    setMuted(next);
  }, []);

  // Global Keyboard Listeners
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isTyping =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable);

      if (isTyping) return;
      if (simRef.current.phase === 'editor_build') return;

      if (screenRef.current === 'title' && (e.code === 'Enter' || e.code === 'Space')) {
        e.preventDefault();
        if (connected) handleQuickStart();
        return;
      }

      if (e.code === 'KeyM') {
        handleToggleMute();
        return;
      }

      if (e.code === 'Escape' || e.code === 'KeyP') {
        if (screenRef.current === 'playing') {
          e.preventDefault();
          clearAndStopInput();
          setScreen('paused');
          return;
        }
        if (screenRef.current === 'paused') {
          e.preventDefault();
          setScreen('playing');
          return;
        }
      }

      if (screenRef.current !== 'playing') return;

      if (simRef.current.phase === 'map_preview') {
        if (e.code === 'Space' || e.code === 'Enter') {
          e.preventDefault();
          sendWs({ type: 'skip_map_preview' });
          return;
        }
        if (
          e.code === 'ArrowUp' ||
          e.code === 'ArrowDown' ||
          e.code === 'ArrowLeft' ||
          e.code === 'ArrowRight' ||
          e.code === 'KeyW' ||
          e.code === 'KeyA' ||
          e.code === 'KeyS' ||
          e.code === 'KeyD'
        ) {
          e.preventDefault();
          previewCamRef.current.mode = 'free';
          inputRef.current.keys.add(e.code);
          return;
        }
      }

      if (
        e.code === 'Space' ||
        e.code === 'ArrowUp' ||
        e.code === 'ArrowDown' ||
        e.code === 'ArrowLeft' ||
        e.code === 'ArrowRight'
      ) {
        e.preventDefault();
      }

      const wasDown = inputRef.current.keys.has(e.code);
      inputRef.current.keys.add(e.code);

      if (!wasDown) {
        if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') {
          inputRef.current.pendingJumpJustPressed = true;
          flushInput();
        }
        if (e.code === 'ShiftLeft' || e.code === 'ShiftRight' || e.code === 'KeyK') {
          inputRef.current.pendingDashJustPressed = true;
          flushInput();
        }
        if (e.code === 'KeyE' || e.code === 'KeyF') {
          inputRef.current.pendingUseItem = true;
          flushInput();
        }
        if (e.code === 'KeyZ') {
          handleCycleZoom();
        }
        if (e.code === 'Equal' || e.code === 'NumpadAdd') {
          handleZoomIn();
        }
        if (e.code === 'Minus' || e.code === 'NumpadSubtract') {
          handleZoomOut();
        }
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      inputRef.current.keys.delete(e.code);
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', clearAndStopInput);
    document.addEventListener('visibilitychange', clearAndStopInput);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', clearAndStopInput);
      document.removeEventListener('visibilitychange', clearAndStopInput);
    };
  }, [
    clearAndStopInput,
    connected,
    flushInput,
    handleCycleZoom,
    handleQuickStart,
    handleToggleMute,
    handleZoomIn,
    handleZoomOut,
    sendWs,
  ]);

  // Isolated 60fps Canvas Render Loop + ResizeObserver
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let viewW = window.innerWidth;
    let viewH = window.innerHeight;

    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      viewW = canvas.clientWidth || window.innerWidth;
      viewH = canvas.clientHeight || window.innerHeight;
      const targetW = Math.round(viewW * dpr);
      const targetH = Math.round(viewH * dpr);
      if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW;
        canvas.height = targetH;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    let rafId = 0;
    let lastTime = performance.now();

    const frame = (now: number) => {
      const rawDt = (now - lastTime) / 1000;
      lastTime = now;
      const dt = Math.min(0.05, Math.max(0.001, rawDt));
      const nowSec = now / 1000;

      const sim = simRef.current;
      if (sim.phase === 'editor_build' && screenRef.current !== 'title') {
        // MapEditorView mounts its own interactive canvas
      } else if (sim.stage && sim.roomCode && screenRef.current !== 'title') {
        // Light client-side position extrapolation between 30Hz snapshots for silky 60fps motion
        const extrapSec = Math.min(0.045, (now - sim.lastSnapshotPerf) / 1000);
        if (sim.phase === 'racing' || sim.phase === 'map_preview') {
          updateStageDynamics(sim.stage, sim.raceTime + extrapSec);
        }

        if (sim.phase === 'map_preview') {
          const pcam = previewCamRef.current;
          const keys = inputRef.current.keys;
          const panLeft = keys.has('ArrowLeft') || keys.has('KeyA');
          const panRight = keys.has('ArrowRight') || keys.has('KeyD');
          const panUp = keys.has('ArrowUp') || keys.has('KeyW');
          const panDown = keys.has('ArrowDown') || keys.has('KeyS');

          if (panLeft || panRight || panUp || panDown) {
            pcam.mode = 'free';
            const panSpeed = 620 / Math.max(0.55, pcam.zoom);
            pcam.x += ((panRight ? 1 : 0) - (panLeft ? 1 : 0)) * panSpeed * dt;
            pcam.y += ((panDown ? 1 : 0) - (panUp ? 1 : 0)) * panSpeed * dt;
          } else if (pcam.mode === 'auto_tour') {
            // Smooth pre-match automatic reconnaissance tour:
            // Objective (Finish Portal) -> Full Map Overview -> Starting Line
            const fit = computeStageOverviewCamera(sim.stage, viewW, viewH);
            const finishCx = sim.stage.finishX + sim.stage.finishW * 0.5;
            const finishCy = sim.stage.finishY + sim.stage.finishH * 0.5;
            const startCx = sim.stage.startX + 40;
            const startCy = sim.stage.startY - 24;

            const previewDuration = Math.max(
              1,
              sim.editorState?.previewTimeLimit || EDITOR_MAP_PREVIEW_TIME
            );
            const progress = Math.min(
              1,
              Math.max(
                0,
                1 - Math.max(0, sim.countdownTimer - extrapSec) / previewDuration
              )
            );

            let targetX = fit.x;
            let targetY = fit.y;
            let targetZoom = fit.zoom;

            if (progress < 0.3) {
              // Phase 1: Focus on the Objective (Finish Portal)
              const t = progress / 0.3;
              targetX = finishCx + (fit.x - finishCx) * t;
              targetY = finishCy + (fit.y - finishCy) * t;
              targetZoom = 1.05 + (fit.zoom - 1.05) * t;
            } else if (progress < 0.72) {
              // Phase 2: Pan across the full stage overview toward Start
              const t = (progress - 0.3) / 0.42;
              targetX = fit.x + (startCx - fit.x) * t;
              targetY = fit.y + (startCy - fit.y) * t;
              targetZoom = fit.zoom;
            } else {
              // Phase 3: Zoom into the Starting Line so the race countdown starts smoothly
              const t = (progress - 0.72) / 0.28;
              targetX = startCx;
              targetY = startCy;
              targetZoom = fit.zoom + (cameraZoomRef.current - fit.zoom) * t;
            }

            const lerp = Math.min(1, dt * 4.5);
            pcam.x += (targetX - pcam.x) * lerp;
            pcam.y += (targetY - pcam.y) * lerp;
            pcam.zoom += (targetZoom - pcam.zoom) * lerp;
          }

          rendererRef.current.setCameraDirectly(pcam.x, pcam.y, pcam.zoom);
        }

        rendererRef.current.renderWorld(
          ctx,
          viewW,
          viewH,
          dt,
          sim.phase === 'racing' || sim.phase === 'map_preview'
            ? sim.raceTime + extrapSec
            : nowSec,
          sim.stage,
          sim.robots,
          sim.projectiles,
          sim.traps,
          sim.phase === 'map_preview' ? '__editor_free_cam__' : sim.playerId
        );
      } else {
        rendererRef.current.renderTitleShowcase(ctx, viewW, viewH, nowSec);
      }

      rafId = requestAnimationFrame(frame);
    };

    rafId = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(rafId);
      ro.disconnect();
    };
  }, []);

  const handleTouchControl = useCallback(
    (key: 'left' | 'right' | 'jump', down: boolean) => {
      if (key === 'left') inputRef.current.touchLeft = down;
      if (key === 'right') inputRef.current.touchRight = down;
      if (key === 'jump') {
        if (down && !inputRef.current.touchJump) {
          inputRef.current.pendingJumpJustPressed = true;
        }
        inputRef.current.touchJump = down;
      }
      flushInput();
    },
    [flushInput]
  );

  const handleUseItemClick = useCallback(() => {
    inputRef.current.pendingUseItem = true;
    flushInput();
  }, [flushInput]);

  const handleDashClick = useCallback(() => {
    inputRef.current.pendingDashJustPressed = true;
    flushInput();
  }, [flushInput]);

  const handleEditorUpdateStatus = useCallback(
    (validated: boolean, objectCount: number, creatorBestTime: number | null) => {
      sendWs({
        type: 'editor_status_update',
        validated,
        objectCount,
        creatorBestTime,
      });
    },
    [sendWs]
  );

  const handleEditorSubmitMap = useCallback(
    (
      stage: StageData,
      creatorBestTime: number,
      courseTimeLimit: number,
      title: string
    ) => {
      sendWs({
        type: 'submit_custom_map',
        stage,
        creatorBestTime,
        courseTimeLimit,
        title,
      });
    },
    [sendWs]
  );

  return (
    <main className="relative w-screen h-screen overflow-hidden bg-[#0F1724]">
      <canvas
        ref={canvasRef}
        data-testid="game-canvas"
        onWheel={handleCanvasWheel}
        onPointerDown={handleCanvasPointerDown}
        onPointerMove={handleCanvasPointerMove}
        onPointerUp={handleCanvasPointerUp}
        onPointerCancel={handleCanvasPointerUp}
        className="block w-full h-full"
      />

      {(screen === 'title' || screen === 'lobby') && (
        <TitleLobby
          mode={screen}
          connected={connected}
          playerId={playerId}
          playerName={playerName}
          colorIndex={colorIndex}
          robotClass={robotClass}
          gameMode={hud.gameMode}
          onChangeName={(name) => {
            profileRef.current.playerName = name;
            setPlayerName(name);
            sendWs({
              type: 'update_profile',
              playerName: name,
              colorIndex: profileRef.current.colorIndex,
              robotClass: profileRef.current.robotClass,
            });
          }}
          onChangeColor={(idx) => {
            profileRef.current.colorIndex = idx;
            setColorIndex(idx);
            sendWs({
              type: 'update_profile',
              playerName: profileRef.current.playerName,
              colorIndex: idx,
              robotClass: profileRef.current.robotClass,
            });
          }}
          onChangeClass={(cls) => {
            profileRef.current.robotClass = cls;
            setRobotClass(cls);
            sendWs({
              type: 'update_profile',
              playerName: profileRef.current.playerName,
              colorIndex: profileRef.current.colorIndex,
              robotClass: cls,
            });
          }}
          onQuickStart={handleQuickStart}
          onStartEditorMode={handleStartEditorMode}
          onCreateRoom={handleCreateRoom}
          onJoinRoom={handleJoinRoom}
          openRooms={openRooms}
          roomCode={roomCode}
          hostId={hud.hostId}
          botCount={hud.botCount}
          robots={hud.robots}
          matchSettings={hud.matchSettings}
          onSetBotCount={(count) => sendWs({ type: 'set_bot_count', botCount: count })}
          onSetGameMode={(gm) => sendWs({ type: 'set_game_mode', gameMode: gm })}
          onUpdateMatchSettings={(settings) =>
            sendWs({ type: 'update_match_settings', settings })
          }
          onStartRace={() => sendWs({ type: 'start_race' })}
          onLeaveRoom={handleLeaveRoom}
          errorMsg={errorMsg}
          onClearError={() => setErrorMsg(null)}
        />
      )}

      {hud.phase === 'editor_build' && hud.editorState && screen !== 'title' && (
        <MapEditorView
          playerId={playerId}
          playerName={playerName}
          colorIndex={colorIndex}
          robotClass={robotClass}
          editorState={hud.editorState}
          onUpdateStatus={handleEditorUpdateStatus}
          onSubmitMap={handleEditorSubmitMap}
          onLeaveRoom={handleLeaveRoom}
        />
      )}

      {(screen === 'playing' || screen === 'paused') &&
        hud.stage &&
        (hud.phase === 'map_preview' ||
          hud.phase === 'countdown' ||
          hud.phase === 'racing') && (
          <GameHud
            stage={hud.stage}
            robots={hud.robots}
            localPlayerId={playerId}
            raceTime={hud.raceTime}
            countdownTimer={hud.countdownTimer}
            phase={hud.phase}
            gameMode={hud.gameMode}
            editorState={hud.editorState}
            muted={muted}
            feedText={feedText}
            cameraZoom={cameraZoom}
            gamepadConnected={gamepadConnected}
            previewCamera={hud.previewCamera}
            onPreviewFitMap={handlePreviewFitMap}
            onPreviewFocusStart={handlePreviewFocusStart}
            onPreviewFocusFinish={handlePreviewFocusFinish}
            onPreviewAutoTour={handlePreviewAutoTour}
            onSkipMapPreview={() => sendWs({ type: 'skip_map_preview' })}
            onCycleZoom={handleCycleZoom}
            onZoomIn={handleZoomIn}
            onZoomOut={handleZoomOut}
            onToggleMute={handleToggleMute}
            onPause={() => {
              clearAndStopInput();
              setScreen('paused');
            }}
            onUseItem={handleUseItemClick}
            onDash={handleDashClick}
            onTouchControl={handleTouchControl}
          />
        )}

      {screen === 'paused' && hud.stage && (
        <PauseModal
          stageNumber={hud.stage.stageNumber}
          onResume={() => setScreen('playing')}
          onLeaveToLobby={handleLeaveRoom}
        />
      )}

      {screen === 'gameover' && hud.stage && (
        <PodiumModal
          stage={hud.stage}
          robots={hud.robots}
          localPlayerId={playerId}
          isHost={hud.hostId === playerId}
          gameMode={hud.gameMode}
          editorState={hud.editorState}
          matchSettings={hud.matchSettings}
          onNextStage={() => sendWs({ type: 'next_stage' })}
          onRestartEditorCycle={() => sendWs({ type: 'restart_editor_cycle' })}
          onReturnLobby={handleLeaveRoom}
        />
      )}
    </main>
  );
}
