import type { BiomeId, ItemType, RobotClassId, RobotColorPalette } from './types';

export const MAX_PLAYERS_PER_ROOM = 10;
export const MIN_PLAYERS_TO_START_HINT = 2;

export const TICK_RATE = 60;
export const FIXED_DT = 1 / TICK_RATE;

export const ROBOT_W = 28;
export const ROBOT_H = 34;

export const GRAVITY = 1650;
export const MAX_FALL_SPEED = 920;

export const BASE_RUN_SPEED = 335;
export const GROUND_ACCEL = 3800;
export const GROUND_DECEL = 5200;
export const AIR_ACCEL = 3200;
export const AIR_DECEL = 3600;

export const JUMP_VELOCITY = -640;
export const SPRING_VELOCITY = -950;
export const JUMP_CUT_FACTOR = 0.45;

export const DASH_SPEED = 560;
export const DASH_DURATION = 0.13;
export const BASE_DASH_COOLDOWN = 2.2;

export const COYOTE_TIME = 0.14;
export const JUMP_BUFFER_TIME = 0.14;

// Conservative envelope used by procedural generator & BFS reachability verifier
// (Sized so even speedster 0.96x jump = ~114px apex comfortably clears SAFE_MAX_STEP_UP = 90px)
export const SAFE_MAX_STEP_UP = 90;
export const SAFE_SPRING_STEP_UP = 205;
export const SAFE_MAX_HORIZONTAL_GAP = 182;

export interface RobotClassConfig {
  id: RobotClassId;
  name: string;
  tagline: string;
  speedMult: number;
  jumpMult: number;
  dashCooldown: number;
  knockbackResist: number;
}

export const ROBOT_CLASSES: Record<RobotClassId, RobotClassConfig> = {
  balanced: {
    id: 'balanced',
    name: 'Mk-II Versátil',
    tagline: 'Atributos equilibrados',
    speedMult: 1.0,
    jumpMult: 1.0,
    dashCooldown: 2.4,
    knockbackResist: 1.0,
  },
  speedster: {
    id: 'speedster',
    name: 'Aero Sprint',
    tagline: '+10% Vel. · Dash ágil',
    speedMult: 1.1,
    jumpMult: 0.96,
    dashCooldown: 1.8,
    knockbackResist: 1.05,
  },
  jumper: {
    id: 'jumper',
    name: 'Titan Mola',
    tagline: '+8% Pulo · Firme',
    speedMult: 0.94,
    jumpMult: 1.08,
    dashCooldown: 2.5,
    knockbackResist: 0.72,
  },
};

export interface BiomeConfig {
  id: BiomeId;
  name: string;
  skyTop: string;
  skyMid: string;
  skyBottom: string;
  gridColor: string;
  towerColor: string;
}

export const BIOME_CONFIGS: Record<BiomeId, BiomeConfig> = {
  foundry: {
    id: 'foundry',
    name: 'Forja Industrial',
    skyTop: '#111A2B',
    skyMid: '#1A273D',
    skyBottom: '#26354D',
    gridColor: 'rgba(148, 163, 184, 0.05)',
    towerColor: 'rgba(15, 23, 42, 0.42)',
  },
  wind_tower: {
    id: 'wind_tower',
    name: 'Torre Eólica',
    skyTop: '#0F2436',
    skyMid: '#1A3B52',
    skyBottom: '#2B536E',
    gridColor: 'rgba(125, 211, 252, 0.06)',
    towerColor: 'rgba(12, 26, 40, 0.36)',
  },
  orbital_core: {
    id: 'orbital_core',
    name: 'Núcleo Orbital',
    skyTop: '#090E1C',
    skyMid: '#141B36',
    skyBottom: '#212B4F',
    gridColor: 'rgba(167, 139, 250, 0.06)',
    towerColor: 'rgba(10, 12, 28, 0.48)',
  },
};

export function getBiomeForStage(stageNumber: number): BiomeId {
  const idx = Math.floor((Math.max(1, stageNumber) - 1) / 2) % 3;
  if (idx === 0) return 'foundry';
  if (idx === 1) return 'wind_tower';
  return 'orbital_core';
}

export const ROBOT_PALETTES: RobotColorPalette[] = [
  { id: 'cobalt', name: 'Cobalto', body: '#3B82F6', shade: '#1D4ED8', visor: '#BAE6FD', accent: '#60A5FA' },
  { id: 'vermilion', name: 'Carmesim', body: '#EF4444', shade: '#B91C1C', visor: '#FED7AA', accent: '#F87171' },
  { id: 'amber', name: 'Âmbar', body: '#F59E0B', shade: '#B45309', visor: '#FEF3C7', accent: '#FBBF24' },
  { id: 'emerald', name: 'Esmeralda', body: '#10B981', shade: '#047857', visor: '#D1FAE5', accent: '#34D399' },
  { id: 'violet', name: 'Violeta', body: '#8B5CF6', shade: '#6D28D9', visor: '#EDE9FE', accent: '#A78BFA' },
  { id: 'coral', name: 'Coral', body: '#FB7185', shade: '#BE123C', visor: '#FFE4E6', accent: '#FDA4AF' },
  { id: 'cyan', name: 'Ciano', body: '#06B6D4', shade: '#0E7490', visor: '#CFFAFE', accent: '#22D3EE' },
  { id: 'gold', name: 'Ouro', body: '#EAB308', shade: '#A16207', visor: '#FEF9C3', accent: '#FACC15' },
  { id: 'lime', name: 'Lima', body: '#84CC16', shade: '#4D7C0F', visor: '#ECFCCB', accent: '#A3E635' },
  { id: 'graphite', name: 'Titânio', body: '#94A3B8', shade: '#475569', visor: '#F8FAFC', accent: '#CBD5E1' },
];

export interface ItemMeta {
  type: ItemType;
  name: string;
  role: string;
  kind: 'buff' | 'attack';
  color: string;
}

export const ITEM_METADATA: Record<ItemType, ItemMeta> = {
  turbo: {
    type: 'turbo',
    name: 'Turbo Overdrive',
    role: '+55% Velocidade e Pulo por 3s',
    kind: 'buff',
    color: '#F59E0B',
  },
  shield: {
    type: 'shield',
    name: 'Escudo Magnético',
    role: 'Bloqueia 1 ataque ou perigo',
    kind: 'buff',
    color: '#3B82F6',
  },
  emp: {
    type: 'emp',
    name: 'Pulso EMP',
    role: 'Desacelera o líder e rivais próximos',
    kind: 'attack',
    color: '#06B6D4',
  },
  rocket: {
    type: 'rocket',
    name: 'Míssil Teleguiado',
    role: 'Persegue e atordoa o rival à frente',
    kind: 'attack',
    color: '#EF4444',
  },
  frost: {
    type: 'frost',
    name: 'Mina Criogênica',
    role: 'Deixa armadilha congelante na pista',
    kind: 'attack',
    color: '#38BDF8',
  },
  magnet: {
    type: 'magnet',
    name: 'Gancho Gravitacional',
    role: 'Impulso adiante e puxa o líder',
    kind: 'attack',
    color: '#A855F7',
  },
  glitch: {
    type: 'glitch',
    name: 'Vírus de Controle',
    role: 'Inverte esquerda/direita do líder',
    kind: 'attack',
    color: '#EC4899',
  },
  warp: {
    type: 'warp',
    name: 'Salto Quântico',
    role: 'Teleporta adiante na pista',
    kind: 'buff',
    color: '#10B981',
  },
  barrier: {
    type: 'barrier',
    name: 'Barreira Laser',
    role: 'Cria barreira que bloqueia e repele rivais',
    kind: 'attack',
    color: '#F97316',
  },
  grease: {
    type: 'grease',
    name: 'Graxa no Chão',
    role: 'Espalha graxa escorregadia na plataforma',
    kind: 'attack',
    color: '#84CC16',
  },
  whirlwind: {
    type: 'whirlwind',
    name: 'Redemoinho',
    role: 'Joga o robô rival bem alto para cima',
    kind: 'attack',
    color: '#22D3EE',
  },
  jetpack: {
    type: 'jetpack',
    name: 'Propulsor Jetpack',
    role: 'Voo propulsado por 3.8s (Segure Pular)',
    kind: 'buff',
    color: '#FB923C',
  },
};

export const ALL_ITEM_TYPES: ItemType[] = [
  'turbo',
  'shield',
  'emp',
  'rocket',
  'frost',
  'magnet',
  'glitch',
  'warp',
  'barrier',
  'grease',
  'whirlwind',
  'jetpack',
];

export const BOT_NAMES = [
  'Bip-01',
  'Volt-X',
  'Engrena',
  'Tork-7',
  'Spark',
  'Krono',
  'Zeta-9',
  'Meca-Pro',
  'Piston',
];

export const DEFAULT_MATCH_SETTINGS: import('./types').MatchSettings = {
  speedMultiplier: 1.0,
  gravityMultiplier: 1.0,
  itemFrequency: 'normal',
  hazardsEnabled: true,
  botDifficulty: 'normal',
  classicStageLength: 'standard',
  classicBiome: 'auto',
  classicTargetStages: 0,
  editorBuildTimeLimit: 120,
  editorCourseTimeLimit: 45,
  editorPreviewSeconds: 8,
};

export function sanitizeMatchSettings(
  raw: Partial<import('./types').MatchSettings> | undefined,
  current: import('./types').MatchSettings = DEFAULT_MATCH_SETTINGS
): import('./types').MatchSettings {
  if (!raw || typeof raw !== 'object') {
    return { ...current };
  }

  const speedAllowed = [0.8, 1.0, 1.25, 1.5];
  const speedMultiplier = speedAllowed.includes(Number(raw.speedMultiplier))
    ? Number(raw.speedMultiplier)
    : current.speedMultiplier;

  const gravityAllowed = [0.65, 0.85, 1.0, 1.2];
  const gravityMultiplier = gravityAllowed.includes(Number(raw.gravityMultiplier))
    ? Number(raw.gravityMultiplier)
    : current.gravityMultiplier;

  const itemFrequency =
    raw.itemFrequency === 'none' ||
    raw.itemFrequency === 'normal' ||
    raw.itemFrequency === 'frenzy'
      ? raw.itemFrequency
      : current.itemFrequency;

  const hazardsEnabled =
    typeof raw.hazardsEnabled === 'boolean' ? raw.hazardsEnabled : current.hazardsEnabled;

  const botDifficulty =
    raw.botDifficulty === 'casual' ||
    raw.botDifficulty === 'normal' ||
    raw.botDifficulty === 'pro'
      ? raw.botDifficulty
      : current.botDifficulty;

  const classicStageLength =
    raw.classicStageLength === 'short' ||
    raw.classicStageLength === 'standard' ||
    raw.classicStageLength === 'long'
      ? raw.classicStageLength
      : current.classicStageLength;

  const classicBiome =
    raw.classicBiome === 'auto' ||
    raw.classicBiome === 'foundry' ||
    raw.classicBiome === 'wind_tower' ||
    raw.classicBiome === 'orbital_core'
      ? raw.classicBiome
      : current.classicBiome;

  const targetStagesAllowed = [0, 3, 5, 10];
  const classicTargetStages = targetStagesAllowed.includes(Number(raw.classicTargetStages))
    ? Number(raw.classicTargetStages)
    : current.classicTargetStages;

  const buildAllowed = [60, 120, 180, 300];
  const editorBuildTimeLimit = buildAllowed.includes(Number(raw.editorBuildTimeLimit))
    ? Number(raw.editorBuildTimeLimit)
    : current.editorBuildTimeLimit;

  const courseAllowed = [30, 45, 60, 90];
  const editorCourseTimeLimit = courseAllowed.includes(Number(raw.editorCourseTimeLimit))
    ? Number(raw.editorCourseTimeLimit)
    : current.editorCourseTimeLimit;

  const previewAllowed = [0, 5, 8, 12];
  const editorPreviewSeconds = previewAllowed.includes(Number(raw.editorPreviewSeconds))
    ? Number(raw.editorPreviewSeconds)
    : current.editorPreviewSeconds;

  return {
    speedMultiplier,
    gravityMultiplier,
    itemFrequency,
    hazardsEnabled,
    botDifficulty,
    classicStageLength,
    classicBiome,
    classicTargetStages,
    editorBuildTimeLimit,
    editorCourseTimeLimit,
    editorPreviewSeconds,
  };
}

