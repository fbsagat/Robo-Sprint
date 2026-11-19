export type GamePhase = 'title' | 'lobby' | 'playing' | 'paused' | 'gameover';

export type RobotClassId = 'balanced' | 'speedster' | 'jumper';

export type BiomeId = 'foundry' | 'wind_tower' | 'orbital_core';

export type ItemType =
  | 'turbo'
  | 'shield'
  | 'emp'
  | 'rocket'
  | 'frost'
  | 'magnet'
  | 'glitch'
  | 'warp'
  | 'barrier'
  | 'grease'
  | 'whirlwind'
  | 'jetpack';

export type PlatformKind =
  | 'solid'
  | 'moving'
  | 'conveyor'
  | 'crumbling'
  | 'start'
  | 'finish'
  | 'checkpoint';

export interface Platform {
  id: number;
  x: number;
  y: number;
  w: number;
  h: number;
  kind: PlatformKind;
  // Moving platform parameters (when kind === 'moving')
  moveAxis?: 'x' | 'y';
  moveRange?: number;
  moveSpeed?: number;
  movePhase?: number;
  // Conveyor speed (px/s, positive pushes right, negative pushes left)
  conveyorSpeed?: number;
  // Crumbling state (sim-driven)
  crumbleState?: 'intact' | 'shaking' | 'fallen';
  crumbleTimer?: number;
  // Base coordinates for deterministic oscillation
  baseX: number;
  baseY: number;
  // Sequential path index & horizontal direction to next platform for dynamic 'S' paths
  pathIndex?: number;
  nextDir?: 1 | -1;
}

export interface BouncePad {
  id: number;
  x: number;
  y: number;
  w: number;
  h: number;
  power: number; // Negative vy impulse
}

export interface WindZone {
  id: number;
  x: number;
  y: number;
  w: number;
  h: number;
  forceY: number; // Negative upward acceleration
}

export interface BoostRing {
  id: number;
  x: number;
  y: number;
  r: number;
  boostVx: number;
  boostVy: number;
}

export interface Bumper {
  id: number;
  x: number;
  y: number;
  r: number;
}

export interface Crystal {
  id: number;
  x: number;
  y: number;
  respawnAt: number;
}

export type HazardKind = 'saw' | 'laser' | 'drone';

export interface Hazard {
  id: number;
  kind: HazardKind;
  x: number;
  y: number;
  radius: number;
  w: number;
  h: number;
  patrolRange?: number;
  patrolSpeed?: number;
  baseX: number;
  baseY?: number;
  cyclePeriod?: number;
  cycleOffset?: number;
}

export interface ItemBox {
  id: number;
  x: number;
  y: number;
  itemType: ItemType;
  respawnAt: number; // Simulation time when available again (0 = available now)
}

export interface StageData {
  stageNumber: number;
  biome: BiomeId;
  seed: number;
  startX: number;
  startY: number;
  finishX: number;
  finishY: number;
  finishW: number;
  finishH: number;
  targetClimb: number;
  horizontalSpan: number;
  abyssY: number;
  platforms: Platform[];
  bouncePads: BouncePad[];
  windZones: WindZone[];
  boostRings: BoostRing[];
  bumpers: Bumper[];
  crystals: Crystal[];
  hazards: Hazard[];
  itemBoxes: ItemBox[];
}

export interface PlayerInput {
  left: boolean;
  right: boolean;
  down?: boolean;
  jump: boolean;
  jumpJustPressed: boolean;
  dashJustPressed: boolean;
  useItem: boolean;
}

export interface RobotState {
  id: string;
  name: string;
  colorIndex: number;
  robotClass: RobotClassId;
  isBot: boolean;
  connected: boolean;

  // Physics
  x: number;
  y: number;
  vx: number;
  vy: number;
  w: number;
  h: number;
  facing: 1 | -1;
  onGround: boolean;
  coyoteTimer: number;
  jumpBufferTimer: number;
  prevJumpHeld: boolean;
  carryingPlatformId: number | null;

  // Dash mechanic
  dashTimer: number;
  dashCooldown: number;
  dashMaxCooldown: number;

  // Checkpoint for instant recovery from falls/hazards (start of stage or last checkpoint)
  checkpointX: number;
  checkpointY: number;
  lastSafeY: number;

  // Visual squash & stride state
  stridePhase: number;
  scaleX: number;
  scaleY: number;

  // Status effects & items
  heldItem: ItemType | null;
  turboTimer: number;
  jetpackTimer: number;
  shieldTimer: number;
  empSlowTimer: number;
  frostTimer: number;
  greaseTimer: number;
  glitchTimer: number; // Swaps left/right controls!
  stunTimer: number;
  invulnTimer: number;

  // Race progress
  crystals: number;
  progress: number; // 0..100
  finished: boolean;
  finishTime: number | null;
  finishRank: number | null;
  score: number;
}

export interface Projectile {
  id: number;
  ownerId: string;
  kind: 'rocket';
  x: number;
  y: number;
  vx: number;
  vy: number;
  targetId: string | null;
  ttl: number;
}

export interface ActiveTrap {
  id: number;
  ownerId: string;
  kind: 'frost_mine' | 'barrier' | 'grease_slick' | 'whirlwind';
  x: number;
  y: number;
  radius: number;
  w?: number;
  h?: number;
  ttl: number;
}

export interface GameEvent {
  id: number;
  type:
    | 'jump'
    | 'dash'
    | 'spring'
    | 'pickup'
    | 'turbo'
    | 'jetpack'
    | 'shield'
    | 'emp'
    | 'rocket_launch'
    | 'rocket_hit'
    | 'frost_drop'
    | 'frost_hit'
    | 'barrier_drop'
    | 'barrier_hit'
    | 'grease_drop'
    | 'grease_hit'
    | 'whirlwind_drop'
    | 'whirlwind_hit'
    | 'magnet'
    | 'glitch'
    | 'warp'
    | 'boost_ring'
    | 'bumper'
    | 'crystal'
    | 'checkpoint'
    | 'fall_reset'
    | 'hurt'
    | 'finish';
  x: number;
  y: number;
  actorId: string;
  actorName?: string;
  targetId?: string;
  targetName?: string;
  itemType?: ItemType;
  colorIndex?: number;
}

export type GameMode = 'classic' | 'editor';

export interface CustomMapEntry {
  creatorId: string;
  creatorName: string;
  creatorColorIndex: number;
  title: string;
  stage: StageData;
  validated: boolean;
  creatorBestTime: number | null;
  courseTimeLimit: number;
}

export interface EditorCreatorStatus {
  playerId: string;
  playerName: string;
  colorIndex: number;
  isBot: boolean;
  validated: boolean;
  submitted: boolean;
  objectCount: number;
  creatorBestTime: number | null;
}

export interface EditorMapResultSummary {
  mapIndex: number;
  creatorId: string;
  creatorName: string;
  mapTitle: string;
  winnerId: string;
  winnerName: string;
  lastPlaceId: string;
  lastPlaceName: string;
}

export interface EditorModeState {
  buildTimeRemaining: number;
  buildTimeLimit: number;
  courseTimeLimit: number;
  previewTimeLimit?: number;
  creators: EditorCreatorStatus[];
  currentMapIndex: number;
  totalMaps: number;
  currentMapCreatorId: string | null;
  currentMapCreatorName: string | null;
  currentMapTitle: string | null;
  currentMapCourseLimit: number;
  isTournamentFinal: boolean;
  roundResults: EditorMapResultSummary[];
}

export interface MatchSettings {
  // Common Settings (Both Classic & Editor Modes)
  speedMultiplier: number; // 0.8 | 1.0 | 1.25 | 1.5
  gravityMultiplier: number; // 0.65 | 0.85 | 1.0 | 1.2
  itemFrequency: 'none' | 'normal' | 'frenzy';
  hazardsEnabled: boolean;
  botDifficulty: 'casual' | 'normal' | 'pro';
  // Classic Mode Specific Settings
  classicStageLength: 'short' | 'standard' | 'long';
  classicBiome: 'auto' | BiomeId;
  classicTargetStages: number; // 0 = Infinito, 3, 5, 10
  // Editor Mode Specific Settings
  editorBuildTimeLimit: number; // 60 | 120 | 180 | 300
  editorCourseTimeLimit: number; // 30 | 45 | 60 | 90
  editorPreviewSeconds: number; // 0 | 5 | 8 | 12
}

export interface MatchState {
  roomCode: string;
  gameMode?: GameMode;
  matchSettings?: MatchSettings;
  stageNumber: number;
  phase: 'lobby' | 'editor_build' | 'map_preview' | 'countdown' | 'racing' | 'podium';
  countdownTimer: number;
  raceTime: number;
  stage: StageData;
  robots: RobotState[];
  projectiles: Projectile[];
  traps: ActiveTrap[];
  events: GameEvent[];
  nextEntityId: number;
  podiumAutoTimer: number;
  editorState?: EditorModeState;
}

export interface RoomSummary {
  code: string;
  hostName: string;
  gameMode?: GameMode;
  matchSettings?: MatchSettings;
  humanCount: number;
  botCount: number;
  maxPlayers: number;
  stageNumber: number;
  phase: MatchState['phase'];
}

export interface RobotColorPalette {
  id: string;
  name: string;
  body: string;
  shade: string;
  visor: string;
  accent: string;
}

// Client <-> Server WebSocket Protocol
export type ClientMessage =
  | { type: 'list_rooms' }
  | {
      type: 'create_room';
      playerName: string;
      colorIndex: number;
      robotClass?: RobotClassId;
      botCount: number;
      quickStart?: boolean;
      gameMode?: GameMode;
      matchSettings?: Partial<MatchSettings>;
    }
  | {
      type: 'join_room';
      roomCode: string;
      playerName: string;
      colorIndex: number;
      robotClass?: RobotClassId;
    }
  | {
      type: 'update_profile';
      playerName: string;
      colorIndex: number;
      robotClass?: RobotClassId;
    }
  | {
      type: 'set_bot_count';
      botCount: number;
    }
  | {
      type: 'set_game_mode';
      gameMode: GameMode;
    }
  | {
      type: 'update_match_settings';
      settings: Partial<MatchSettings>;
    }
  | { type: 'start_race' }
  | {
      type: 'editor_status_update';
      validated: boolean;
      objectCount: number;
      creatorBestTime: number | null;
    }
  | {
      type: 'submit_custom_map';
      stage: StageData;
      creatorBestTime: number;
      courseTimeLimit?: number;
      title?: string;
    }
  | { type: 'skip_map_preview' }
  | { type: 'next_stage' }
  | { type: 'restart_editor_cycle' }
  | { type: 'return_lobby' }
  | { type: 'leave_room' }
  | {
      type: 'input';
      left: boolean;
      right: boolean;
      down?: boolean;
      jump: boolean;
      jumpJustPressed: boolean;
      dashJustPressed: boolean;
      useItem: boolean;
    };

export type ServerMessage =
  | { type: 'welcome'; playerId: string }
  | { type: 'rooms_list'; rooms: RoomSummary[] }
  | {
      type: 'room_joined';
      roomCode: string;
      hostId: string;
      botCount: number;
      gameMode: GameMode;
      matchSettings: MatchSettings;
      state: MatchState;
    }
  | {
      type: 'stage_loaded';
      stage: StageData;
      stageNumber: number;
      hostId: string;
      botCount: number;
      gameMode?: GameMode;
      matchSettings?: MatchSettings;
      editorState?: EditorModeState;
    }
  | {
      type: 'state_snapshot';
      hostId: string;
      botCount: number;
      gameMode?: GameMode;
      matchSettings?: MatchSettings;
      phase: MatchState['phase'];
      stageNumber: number;
      countdownTimer: number;
      raceTime: number;
      robots: RobotState[];
      projectiles: Projectile[];
      traps: ActiveTrap[];
      itemBoxes: ItemBox[];
      collectedCrystalIds: number[];
      crumblingStates: Array<{ id: number; state: 'intact' | 'shaking' | 'fallen' }>;
      events: GameEvent[];
      editorState?: EditorModeState;
    }
  | { type: 'error'; message: string };

