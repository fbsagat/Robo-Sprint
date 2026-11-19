import {
  ALL_ITEM_TYPES,
  ROBOT_H,
  SPRING_VELOCITY,
} from './constants';
import { createRng, generateStage } from './generator';
import type {
  BiomeId,
  HazardKind,
  ItemType,
  Platform,
  PlatformKind,
  RobotState,
  StageData,
} from './types';

export const EDITOR_BUILD_TIME_LIMIT = 120; // Seconds to build & validate map
export const EDITOR_COURSE_TIME_LIMIT = 45; // Max seconds to complete the course in playtest & battle
export const EDITOR_MAP_PREVIEW_TIME = 8; // Seconds for players to observe each custom map before the race countdown starts

export type EditorToolCategory =
  | 'platforms'
  | 'boosts'
  | 'items'
  | 'hazards'
  | 'actions';

export type EditorToolSpec =
  | {
      kind: 'platform';
      platformKind: Exclude<PlatformKind, 'start' | 'finish'>;
      width: number;
      moveAxis?: 'x' | 'y';
      conveyorDir?: 1 | -1;
    }
  | {
      kind: 'move_finish';
    }
  | {
      kind: 'bounce_pad';
    }
  | {
      kind: 'wind_zone';
    }
  | {
      kind: 'boost_ring';
    }
  | {
      kind: 'bumper';
    }
  | {
      kind: 'crystal';
    }
  | {
      kind: 'item_box';
      itemType: ItemType;
    }
  | {
      kind: 'hazard';
      hazardKind: HazardKind;
    }
  | {
      kind: 'eraser';
    };

export function snapCoord(value: number, grid = 16, enabled = true): number {
  if (!enabled || grid <= 1) return Math.round(value);
  return Math.round(value / grid) * grid;
}

export function countEditorStageObjects(stage: StageData): number {
  const userPlatforms = stage.platforms.filter(
    (p) => p.kind !== 'start' && p.kind !== 'finish'
  ).length;
  return (
    userPlatforms +
    stage.bouncePads.length +
    stage.windZones.length +
    stage.boostRings.length +
    stage.bumpers.length +
    stage.crystals.length +
    stage.hazards.length +
    stage.itemBoxes.length
  );
}

/**
 * Recalculates stage bounding metrics (startX/Y, finishX/Y, targetClimb, horizontalSpan,
 * abyssY) and assigns sequential pathIndex + nextDir along platforms from Start to Finish
 * so camera, 0..100% progress, 2D Minimap, and Bot AI work on maps of any size.
 */
export function recalculateStageBounds(rawStage: StageData): StageData {
  const stage: StageData = structuredClone(rawStage);

  let startPlat = stage.platforms.find((p) => p.kind === 'start');
  if (!startPlat) {
    startPlat = {
      id: 1,
      x: 60,
      y: 0,
      w: 220,
      h: 26,
      kind: 'start',
      baseX: 60,
      baseY: 0,
      pathIndex: 0,
      nextDir: 1,
    };
    stage.platforms.unshift(startPlat);
  }

  let finishPlat = stage.platforms.find((p) => p.kind === 'finish');
  if (!finishPlat) {
    finishPlat = {
      id: 2,
      x: startPlat.baseX + 460,
      y: startPlat.baseY - 64,
      w: 220,
      h: 26,
      kind: 'finish',
      baseX: startPlat.baseX + 460,
      baseY: startPlat.baseY - 64,
    };
    stage.platforms.push(finishPlat);
  }

  stage.startX = Math.round(startPlat.baseX + 70);
  stage.startY = Math.round(startPlat.baseY - ROBOT_H);

  stage.finishW = 72;
  stage.finishH = 88;
  stage.finishX = Math.round(finishPlat.baseX + finishPlat.w * 0.5 - stage.finishW * 0.5);
  stage.finishY = Math.round(finishPlat.baseY - stage.finishH);

  // Order platforms along the progression vector from Start to Finish
  const sx = startPlat.baseX + startPlat.w * 0.5;
  const sy = startPlat.baseY;
  const fx = finishPlat.baseX + finishPlat.w * 0.5;
  const fy = finishPlat.baseY;
  const vx = fx - sx;
  const vy = fy - sy;
  const vLenSq = Math.max(1, vx * vx + vy * vy);

  const intermediate = stage.platforms
    .filter((p) => p.id !== startPlat!.id && p.id !== finishPlat!.id)
    .sort((a, b) => {
      const acx = a.baseX + a.w * 0.5;
      const bcx = b.baseX + b.w * 0.5;
      const projA = ((acx - sx) * vx + (a.baseY - sy) * vy) / vLenSq;
      const projB = ((bcx - sx) * vx + (b.baseY - sy) * vy) / vLenSq;
      if (Math.abs(projA - projB) > 0.04) return projA - projB;
      return b.baseY - a.baseY || acx - bcx;
    });

  const ordered: Platform[] = [startPlat, ...intermediate, finishPlat];
  for (let i = 0; i < ordered.length; i++) {
    const curr = ordered[i];
    curr.pathIndex = i;
    const next = ordered[i + 1];
    if (next) {
      const currCx = curr.baseX + curr.w * 0.5;
      const nextCx = next.baseX + next.w * 0.5;
      curr.nextDir = nextCx >= currCx ? 1 : -1;
    } else {
      curr.nextDir = 1;
    }
  }
  stage.platforms = ordered;

  let minX = Math.min(stage.startX, stage.finishX);
  let maxX = Math.max(stage.startX + 40, stage.finishX + stage.finishW);
  let minY = Math.min(stage.startY, stage.finishY);
  let maxY = Math.max(stage.startY + ROBOT_H, stage.finishY + stage.finishH);

  for (const p of stage.platforms) {
    minX = Math.min(minX, p.baseX);
    maxX = Math.max(maxX, p.baseX + p.w);
    minY = Math.min(minY, p.baseY);
    maxY = Math.max(maxY, p.baseY + p.h);
  }
  for (const pad of stage.bouncePads) {
    minX = Math.min(minX, pad.x);
    maxX = Math.max(maxX, pad.x + pad.w);
    minY = Math.min(minY, pad.y);
    maxY = Math.max(maxY, pad.y + pad.h);
  }
  for (const wz of stage.windZones) {
    minX = Math.min(minX, wz.x);
    maxX = Math.max(maxX, wz.x + wz.w);
    minY = Math.min(minY, wz.y);
    maxY = Math.max(maxY, wz.y + wz.h);
  }
  for (const ring of stage.boostRings) {
    minX = Math.min(minX, ring.x - ring.r);
    maxX = Math.max(maxX, ring.x + ring.r);
    minY = Math.min(minY, ring.y - ring.r);
    maxY = Math.max(maxY, ring.y + ring.r);
  }
  for (const bmp of stage.bumpers) {
    minX = Math.min(minX, bmp.x - bmp.r);
    maxX = Math.max(maxX, bmp.x + bmp.r);
    minY = Math.min(minY, bmp.y - bmp.r);
    maxY = Math.max(maxY, bmp.y + bmp.r);
  }
  for (const box of stage.itemBoxes) {
    minX = Math.min(minX, box.x - 30);
    maxX = Math.max(maxX, box.x + 30);
    minY = Math.min(minY, box.y - 30);
    maxY = Math.max(maxY, box.y + 30);
  }
  for (const cry of stage.crystals) {
    minX = Math.min(minX, cry.x - 20);
    maxX = Math.max(maxX, cry.x + 20);
    minY = Math.min(minY, cry.y - 20);
    maxY = Math.max(maxY, cry.y + 20);
  }

  stage.targetClimb = Math.max(
    120,
    Math.round(Math.max(startPlat.baseY - minY, maxY - startPlat.baseY, Math.abs(fy - sy)))
  );
  stage.horizontalSpan = Math.max(600, Math.round(maxX - minX));
  stage.abyssY = Math.round(Math.max(startPlat.baseY, maxY) + 520);

  return stage;
}

/**
 * Creates a completely zeroed-out starter custom stage for Editor Mode:
 * ONLY the mandatory Start platform and Finish portal, with zero placed items or extra platforms.
 */
export function createBlankEditorStage(
  stageNumber = 1,
  biome: BiomeId = 'foundry',
  seed = 10101
): StageData {
  const platforms: Platform[] = [
    {
      id: 1,
      x: 60,
      y: 0,
      w: 250,
      h: 26,
      kind: 'start',
      baseX: 60,
      baseY: 0,
      pathIndex: 0,
      nextDir: 1,
    },
    {
      id: 2,
      x: 520,
      y: -64,
      w: 230,
      h: 26,
      kind: 'finish',
      baseX: 520,
      baseY: -64,
      pathIndex: 1,
      nextDir: 1,
    },
  ];

  const baseStage: StageData = {
    stageNumber,
    biome,
    seed,
    startX: 130,
    startY: -ROBOT_H,
    finishX: 599,
    finishY: -152,
    finishW: 72,
    finishH: 88,
    targetClimb: 120,
    horizontalSpan: 690,
    abyssY: 460,
    platforms,
    bouncePads: [],
    windZones: [],
    boostRings: [],
    bumpers: [],
    crystals: [],
    hazards: [],
    itemBoxes: [],
  };

  return recalculateStageBounds(baseStage);
}

/**
 * Generates an S-curve base template stage that the player can freely edit.
 */
export function createTemplateEditorStage(seed = Date.now()): StageData {
  const generated = generateStage(1, seed);
  return recalculateStageBounds(generated);
}

function nextEditorEntityId(stage: StageData): number {
  let maxId = 100;
  for (const p of stage.platforms) maxId = Math.max(maxId, p.id);
  for (const b of stage.bouncePads) maxId = Math.max(maxId, b.id);
  for (const w of stage.windZones) maxId = Math.max(maxId, w.id);
  for (const r of stage.boostRings) maxId = Math.max(maxId, r.id);
  for (const b of stage.bumpers) maxId = Math.max(maxId, b.id);
  for (const c of stage.crystals) maxId = Math.max(maxId, c.id);
  for (const h of stage.hazards) maxId = Math.max(maxId, h.id);
  for (const i of stage.itemBoxes) maxId = Math.max(maxId, i.id);
  return maxId + 1;
}

/**
 * Places an object or moves the Finish Portal at (worldX, worldY) in the Editor.
 * No artificial limit on object count or map dimensions!
 */
export function placeEditorItem(
  currentStage: StageData,
  tool: EditorToolSpec,
  worldX: number,
  worldY: number,
  snap = true
): StageData {
  if (tool.kind === 'eraser') {
    return eraseEditorItemAt(currentStage, worldX, worldY).stage;
  }

  const stage = structuredClone(currentStage);
  const id = nextEditorEntityId(stage);
  const sx = snapCoord(worldX, 16, snap);
  const sy = snapCoord(worldY, 16, snap);

  switch (tool.kind) {
    case 'move_finish': {
      const finishPlat = stage.platforms.find((p) => p.kind === 'finish');
      if (finishPlat) {
        const newX = Math.round(sx - finishPlat.w * 0.5);
        const newY = Math.round(sy);
        finishPlat.x = newX;
        finishPlat.y = newY;
        finishPlat.baseX = newX;
        finishPlat.baseY = newY;
      }
      break;
    }

    case 'platform': {
      const w = Math.max(80, Math.min(520, Math.round(tool.width)));
      const h = tool.platformKind === 'checkpoint' ? 24 : 22;
      const px = Math.round(sx - w * 0.5);
      const py = Math.round(sy - h * 0.5);

      const newPlat: Platform = {
        id,
        x: px,
        y: py,
        w,
        h,
        kind: tool.platformKind,
        baseX: px,
        baseY: py,
      };

      if (tool.platformKind === 'moving') {
        newPlat.moveAxis = tool.moveAxis ?? 'x';
        newPlat.moveRange = newPlat.moveAxis === 'x' ? 78 : 56;
        newPlat.moveSpeed = 1.9;
        newPlat.movePhase = 0;
      } else if (tool.platformKind === 'conveyor') {
        newPlat.conveyorSpeed = (tool.conveyorDir ?? 1) * 125;
      } else if (tool.platformKind === 'crumbling') {
        newPlat.crumbleState = 'intact';
        newPlat.crumbleTimer = 0;
      }

      stage.platforms.push(newPlat);
      break;
    }

    case 'bounce_pad': {
      // Snap onto nearest platform surface if close, otherwise place at cursor
      const padW = 42;
      const padH = 14;
      let px = Math.round(sx - padW * 0.5);
      let py = Math.round(sy - padH);
      const host = findNearestPlatformTop(stage.platforms, sx, sy, 52);
      if (host) {
        px = Math.max(host.baseX + 8, Math.min(host.baseX + host.w - padW - 8, px));
        py = host.baseY - padH;
      }
      stage.bouncePads.push({
        id,
        x: px,
        y: py,
        w: padW,
        h: padH,
        power: SPRING_VELOCITY,
      });
      break;
    }

    case 'wind_zone': {
      const w = 88;
      const h = 190;
      stage.windZones.push({
        id,
        x: Math.round(sx - w * 0.5),
        y: Math.round(sy - h * 0.5),
        w,
        h,
        forceY: -1950,
      });
      break;
    }

    case 'boost_ring': {
      stage.boostRings.push({
        id,
        x: sx,
        y: sy,
        r: 26,
        boostVx: 520,
        boostVy: -500,
      });
      break;
    }

    case 'bumper': {
      stage.bumpers.push({
        id,
        x: sx,
        y: sy,
        r: 20,
      });
      break;
    }

    case 'crystal': {
      stage.crystals.push({
        id,
        x: sx,
        y: sy,
        respawnAt: 0,
      });
      break;
    }

    case 'item_box': {
      stage.itemBoxes.push({
        id,
        x: sx,
        y: sy,
        itemType: tool.itemType,
        respawnAt: 0,
      });
      break;
    }

    case 'hazard': {
      if (tool.hazardKind === 'saw') {
        stage.hazards.push({
          id,
          kind: 'saw',
          x: sx,
          y: sy,
          radius: 19,
          w: 38,
          h: 38,
          patrolRange: 48,
          patrolSpeed: 2.2,
          baseX: sx,
          baseY: sy,
        });
      } else if (tool.hazardKind === 'laser') {
        stage.hazards.push({
          id,
          kind: 'laser',
          x: sx - 8,
          y: sy - 76,
          radius: 16,
          w: 16,
          h: 76,
          baseX: sx - 8,
          baseY: sy - 76,
          cyclePeriod: 2.6,
          cycleOffset: 0,
        });
      } else {
        stage.hazards.push({
          id,
          kind: 'drone',
          x: sx,
          y: sy,
          radius: 18,
          w: 36,
          h: 36,
          patrolRange: 45,
          patrolSpeed: 2.1,
          baseX: sx,
          baseY: sy,
        });
      }
      break;
    }
  }

  return recalculateStageBounds(stage);
}

function findNearestPlatformTop(
  platforms: Platform[],
  x: number,
  y: number,
  maxVertDist: number
): Platform | null {
  let best: Platform | null = null;
  let bestDist = maxVertDist;
  for (const p of platforms) {
    if (x >= p.baseX - 16 && x <= p.baseX + p.w + 16) {
      const dy = Math.abs(y - p.baseY);
      if (dy <= bestDist) {
        bestDist = dy;
        best = p;
      }
    }
  }
  return best;
}

/**
 * Removes all placed objects within hitRadius around (worldX, worldY).
 * Never removes the required Start or Finish platforms.
 */
export function eraseEditorItemAt(
  currentStage: StageData,
  worldX: number,
  worldY: number,
  hitRadius = 42
): { stage: StageData; removed: boolean } {
  let removed = false;

  const itemBoxes = currentStage.itemBoxes.filter((b) => {
    const hit = Math.hypot(b.x - worldX, b.y - worldY) <= hitRadius;
    if (hit) removed = true;
    return !hit;
  });

  const hazards = currentStage.hazards.filter((h) => {
    const cx = h.kind === 'laser' ? h.x + h.w * 0.5 : h.x;
    const cy = h.kind === 'laser' ? h.y + h.h * 0.5 : h.y;
    const hit = Math.hypot(cx - worldX, cy - worldY) <= hitRadius;
    if (hit) removed = true;
    return !hit;
  });

  const bouncePads = currentStage.bouncePads.filter((b) => {
    const hit =
      worldX >= b.x - 20 &&
      worldX <= b.x + b.w + 20 &&
      worldY >= b.y - 24 &&
      worldY <= b.y + b.h + 24;
    if (hit) removed = true;
    return !hit;
  });

  const boostRings = currentStage.boostRings.filter((r) => {
    const hit = Math.hypot(r.x - worldX, r.y - worldY) <= hitRadius;
    if (hit) removed = true;
    return !hit;
  });

  const bumpers = currentStage.bumpers.filter((b) => {
    const hit = Math.hypot(b.x - worldX, b.y - worldY) <= hitRadius;
    if (hit) removed = true;
    return !hit;
  });

  const crystals = currentStage.crystals.filter((c) => {
    const hit = Math.hypot(c.x - worldX, c.y - worldY) <= hitRadius;
    if (hit) removed = true;
    return !hit;
  });

  const windZones = currentStage.windZones.filter((w) => {
    const hit =
      worldX >= w.x - 10 &&
      worldX <= w.x + w.w + 10 &&
      worldY >= w.y - 10 &&
      worldY <= w.y + w.h + 10;
    if (hit) removed = true;
    return !hit;
  });

  const platforms = currentStage.platforms.filter((p) => {
    if (p.kind === 'start' || p.kind === 'finish') return true;
    const hit =
      worldX >= p.baseX - 16 &&
      worldX <= p.baseX + p.w + 16 &&
      worldY >= p.baseY - 18 &&
      worldY <= p.baseY + p.h + 18;
    if (hit) removed = true;
    return !hit;
  });

  if (!removed) {
    return { stage: currentStage, removed: false };
  }

  const nextStage: StageData = {
    ...structuredClone(currentStage),
    platforms: structuredClone(platforms),
    bouncePads: structuredClone(bouncePads),
    windZones: structuredClone(windZones),
    boostRings: structuredClone(boostRings),
    bumpers: structuredClone(bumpers),
    crystals: structuredClone(crystals),
    hazards: structuredClone(hazards),
    itemBoxes: structuredClone(itemBoxes),
  };

  return { stage: recalculateStageBounds(nextStage), removed: true };
}

/**
 * Sanitizes and normalizes a client-submitted custom stage on the server.
 */
export function sanitizeSubmittedStage(rawStage: StageData, stageNumber = 1): StageData {
  if (!rawStage || !Array.isArray(rawStage.platforms) || rawStage.platforms.length < 2) {
    return createBlankEditorStage(stageNumber);
  }
  const cloned = structuredClone(rawStage);
  cloned.stageNumber = stageNumber;
  for (const p of cloned.platforms) {
    p.x = p.baseX;
    p.y = p.baseY;
    if (p.kind === 'crumbling') {
      p.crumbleState = 'intact';
      p.crumbleTimer = 0;
    }
  }
  for (const box of cloned.itemBoxes) {
    box.respawnAt = 0;
    if (!ALL_ITEM_TYPES.includes(box.itemType)) {
      box.itemType = 'turbo';
    }
  }
  for (const c of cloned.crystals) {
    c.respawnAt = 0;
  }
  return recalculateStageBounds(cloned);
}

/**
 * Generates an authored, physics-valid custom map for an AI bot competitor
 * so every participant in Editor Mode contributes a distinct map to the playlist.
 */
export function generateBotCustomStage(
  botName: string,
  botIndex: number,
  seed: number
): StageData {
  const rng = createRng(seed + botIndex * 7919);
  const biomes: BiomeId[] = ['foundry', 'wind_tower', 'orbital_core'];
  const biome = biomes[botIndex % biomes.length];

  // Compact, punchy 5-to-7 platform custom course designed by the bot
  const numSteps = 4 + (botIndex % 3);
  const platforms: Platform[] = [];
  let idSeq = 1;

  platforms.push({
    id: idSeq++,
    x: 60,
    y: 0,
    w: 240,
    h: 26,
    kind: 'start',
    baseX: 60,
    baseY: 0,
  });

  let curX = 60;
  let curY = 0;
  let curW = 240;
  let dir: 1 | -1 = 1;

  const itemBoxes: StageData['itemBoxes'] = [];
  const bouncePads: StageData['bouncePads'] = [];
  const hazards: StageData['hazards'] = [];
  const crystals: StageData['crystals'] = [];

  for (let i = 0; i < numSteps; i++) {
    if (i === Math.floor(numSteps / 2) && numSteps >= 5) {
      dir = -1;
    } else if (i > Math.floor(numSteps / 2)) {
      dir = 1;
    }

    const w = 175 + Math.floor(rng() * 55);
    const gapX = 75 + Math.floor(rng() * 55);
    const stepUp = 58 + Math.floor(rng() * 34);
    const nextX = dir === 1 ? curX + curW + gapX : curX - w - gapX;
    const nextY = curY - stepUp;

    const kind: PlatformKind =
      i === Math.floor(numSteps / 2)
        ? 'checkpoint'
        : i % 2 === 1
        ? 'conveyor'
        : 'solid';

    const plat: Platform = {
      id: idSeq++,
      x: nextX,
      y: nextY,
      w,
      h: 22,
      kind,
      baseX: nextX,
      baseY: nextY,
      conveyorSpeed: kind === 'conveyor' ? dir * 105 : undefined,
    };
    platforms.push(plat);

    // Scatter signature items chosen by the bot
    const itemType = ALL_ITEM_TYPES[(botIndex * 3 + i) % ALL_ITEM_TYPES.length];
    itemBoxes.push({
      id: idSeq++,
      x: Math.round(nextX + w * (0.28 + (i % 2) * 0.44)),
      y: nextY - 40,
      itemType,
      respawnAt: 0,
    });

    crystals.push({
      id: idSeq++,
      x: Math.round(nextX + w * 0.5),
      y: nextY - 36,
      respawnAt: 0,
    });

    if (i % 2 === 1 && w >= 190) {
      hazards.push({
        id: idSeq++,
        kind: 'saw',
        x: Math.round(nextX + w * 0.5),
        y: nextY - 16,
        radius: 17,
        w: 34,
        h: 34,
        patrolRange: 34,
        patrolSpeed: 2.0,
        baseX: Math.round(nextX + w * 0.5),
        baseY: nextY - 16,
      });
    }

    curX = nextX;
    curY = nextY;
    curW = w;
  }

  const finishX = curX + curW + 85;
  const finishY = curY - 56;
  platforms.push({
    id: idSeq++,
    x: finishX,
    y: finishY,
    w: 230,
    h: 26,
    kind: 'finish',
    baseX: finishX,
    baseY: finishY,
  });

  // Add an item box on the start platform too
  itemBoxes.push({
    id: idSeq++,
    x: 220,
    y: -40,
    itemType: ALL_ITEM_TYPES[botIndex % ALL_ITEM_TYPES.length],
    respawnAt: 0,
  });

  const stage: StageData = {
    stageNumber: botIndex + 1,
    biome,
    seed,
    startX: 130,
    startY: -ROBOT_H,
    finishX: finishX + 80,
    finishY: finishY - 88,
    finishW: 72,
    finishH: 88,
    targetClimb: Math.abs(finishY),
    horizontalSpan: Math.abs(finishX) + 400,
    abyssY: 460,
    platforms,
    bouncePads,
    windZones: [],
    boostRings: [],
    bumpers: [],
    crystals,
    hazards,
    itemBoxes,
  };

  return recalculateStageBounds(stage);
}

/**
 * Evaluates a finished Editor Mode map battle:
 * - First to arrive wins the map (+100 pts)
 * - Intermediate placements receive proportional points
 * - Last to arrive loses the map (0 pts for the round)
 */
export function evaluateEditorMapStandings(robots: RobotState[]): {
  ordered: RobotState[];
  winner: RobotState | null;
  lastPlace: RobotState | null;
  pointsAwarded: Map<string, number>;
} {
  const ordered = [...robots].sort((a, b) => {
    const rankA = a.finishRank ?? 999;
    const rankB = b.finishRank ?? 999;
    if (rankA !== rankB) return rankA - rankB;
    if (a.finished !== b.finished) return a.finished ? -1 : 1;
    if (a.finishTime !== null && b.finishTime !== null) {
      return a.finishTime - b.finishTime;
    }
    return b.progress - a.progress || b.x - a.x;
  });

  const winner = ordered[0] ?? null;
  const lastPlace = ordered.length > 1 ? ordered[ordered.length - 1] : ordered[0] ?? null;
  const pointsAwarded = new Map<string, number>();

  const total = ordered.length;
  for (let i = 0; i < total; i++) {
    const r = ordered[i];
    if (i === 0) {
      // 1st place wins the map!
      pointsAwarded.set(r.id, 100);
    } else if (i === total - 1 && total > 1) {
      // Last place loses the round!
      pointsAwarded.set(r.id, 0);
    } else {
      const ratio = (total - 1 - i) / Math.max(1, total - 1);
      pointsAwarded.set(r.id, Math.round(ratio * 65));
    }
  }

  return {
    ordered,
    winner,
    lastPlace,
    pointsAwarded,
  };
}
