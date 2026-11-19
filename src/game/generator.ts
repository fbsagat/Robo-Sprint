import {
  ALL_ITEM_TYPES,
  getBiomeForStage,
  GRAVITY,
  JUMP_VELOCITY,
  ROBOT_H,
  ROBOT_W,
  SAFE_MAX_HORIZONTAL_GAP,
  SAFE_MAX_STEP_UP,
  SAFE_SPRING_STEP_UP,
  SPRING_VELOCITY,
} from './constants';
import type {
  BoostRing,
  BouncePad,
  Bumper,
  Crystal,
  Hazard,
  ItemBox,
  ItemType,
  MatchSettings,
  Platform,
  StageData,
  WindZone,
} from './types';

/**
 * Deterministic Mulberry32 PRNG
 */
export function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randRange(rng: () => number, min: number, max: number): number {
  return min + rng() * (max - min);
}

function randInt(rng: () => number, min: number, max: number): number {
  return Math.floor(randRange(rng, min, max + 1));
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function pickScatteredItemType(rng: () => number, boxCounter: number): ItemType {
  // Cycle through key featured items with random permutation so every item type
  // (including jetpack, whirlwind, barrier, grease) is visibly represented in boxes across the map.
  if (boxCounter % 5 === 1) return 'jetpack';
  if (boxCounter % 5 === 2) return 'whirlwind';
  if (boxCounter % 5 === 3) return 'barrier';
  if (boxCounter % 5 === 4) return 'grease';
  const idx = Math.floor(rng() * ALL_ITEM_TYPES.length);
  return ALL_ITEM_TYPES[idx] ?? 'turbo';
}

function getPlatformSweep(p: Platform): {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
} {
  const rx = p.kind === 'moving' && p.moveAxis === 'x' ? Math.abs(p.moveRange ?? 0) : 0;
  const ry = p.kind === 'moving' && p.moveAxis === 'y' ? Math.abs(p.moveRange ?? 0) : 0;
  return {
    minX: p.baseX - rx,
    maxX: p.baseX + rx + p.w,
    minY: p.baseY - ry,
    maxY: p.baseY + ry,
  };
}

/**
 * Checks whether a robot (even with the Speedster's 0.96x jump) can safely jump
 * from platform A to platform B within the conservative physics envelope.
 */
export function canJumpBetween(
  from: Platform,
  to: Platform,
  bouncePads: BouncePad[],
  hazards: Hazard[]
): boolean {
  if (from.id === to.id) return false;

  const a = getPlatformSweep(from);
  const b = getPlatformSweep(to);

  const hasSpring = bouncePads.some(
    (pad) =>
      pad.x + pad.w > from.baseX &&
      pad.x < from.baseX + from.w &&
      Math.abs(pad.y + pad.h - from.baseY) <= 10
  );

  const maxStepUp = hasSpring ? SAFE_SPRING_STEP_UP : SAFE_MAX_STEP_UP;
  const launchVy = hasSpring ? SPRING_VELOCITY : JUMP_VELOCITY * 0.96;

  const stepUp = a.minY - b.maxY;
  if (stepUp > maxStepUp) {
    return false;
  }

  let horizGap = 0;
  if (b.minX > a.maxX) {
    horizGap = b.minX - a.maxX;
  } else if (a.minX > b.maxX) {
    horizGap = a.minX - b.maxX;
  }

  if (horizGap === 0 && stepUp > 8) {
    const leftEdgeClearance = a.minX < b.minX - (ROBOT_W + 12);
    const rightEdgeClearance = a.maxX > b.maxX + (ROBOT_W + 12);
    if (!leftEdgeClearance && !rightEdgeClearance) {
      return false;
    }
  }

  const dyScreen = -stepUp;
  const disc = launchVy * launchVy + 2 * GRAVITY * dyScreen;
  if (disc < 0) return false;

  const airTime = (-launchVy + Math.sqrt(disc)) / GRAVITY;
  // Account for opposing conveyor belts when jumping from `from`
  const movingRight = b.minX >= a.minX;
  const conveyorOpposes =
    from.kind === 'conveyor' &&
    ((movingRight && (from.conveyorSpeed ?? 0) < 0) ||
      (!movingRight && (from.conveyorSpeed ?? 0) > 0));
  const effectiveSpeed = conveyorOpposes ? 205 : 248;

  const maxReachableGap = Math.min(
    SAFE_MAX_HORIZONTAL_GAP + (hasSpring ? 45 : 0),
    airTime * effectiveSpeed - ROBOT_W * 0.5
  );

  if (horizGap > maxReachableGap) {
    return false;
  }

  if (to.kind !== 'finish' && to.kind !== 'start') {
    const safeLandingZones = getSafeLandingWidth(to, hazards);
    if (safeLandingZones < ROBOT_W + 10) {
      return false;
    }
  }

  return true;
}

function getSafeLandingWidth(p: Platform, hazards: Hazard[]): number {
  const blocking = hazards.filter(
    (h) =>
      h.baseX + h.w > p.baseX &&
      h.baseX < p.baseX + p.w &&
      h.y + h.h >= p.baseY - ROBOT_H - 6 &&
      h.y <= p.baseY + 8
  );
  if (blocking.length === 0) return p.w;

  let covered = 0;
  for (const h of blocking) {
    const overlapStart = Math.max(p.baseX, h.baseX);
    const overlapEnd = Math.min(p.baseX + p.w, h.baseX + h.w);
    if (overlapEnd > overlapStart) {
      covered += overlapEnd - overlapStart;
    }
  }
  return Math.max(0, p.w - covered);
}

export interface ReachabilityReport {
  completable: boolean;
  visitedIds: Set<number>;
  furthestPlatformId: number;
  furthestX: number;
  minYReached: number;
}

/**
 * Formal BFS graph reachability verifier: guarantees a valid physical path
 * exists from the Start platform to the Finish platform.
 */
export function verifyStageCompletable(stage: StageData): ReachabilityReport {
  const startPlat = stage.platforms.find((p) => p.kind === 'start') ?? stage.platforms[0];
  const finishPlat = stage.platforms.find((p) => p.kind === 'finish');

  if (!startPlat || !finishPlat) {
    return {
      completable: false,
      visitedIds: new Set(),
      furthestPlatformId: -1,
      furthestX: 0,
      minYReached: 0,
    };
  }

  const visited = new Set<number>([startPlat.id]);
  const queue: Platform[] = [startPlat];
  let furthestPlatform = startPlat;

  while (queue.length > 0) {
    const current = queue.shift()!;
    const curIdx = current.pathIndex ?? -1;
    const bestIdx = furthestPlatform.pathIndex ?? -1;
    if (
      (curIdx >= 0 && curIdx > bestIdx) ||
      (curIdx < 0 &&
        (current.baseX + current.w > furthestPlatform.baseX + furthestPlatform.w ||
          (current.baseX >= furthestPlatform.baseX && current.baseY < furthestPlatform.baseY)))
    ) {
      furthestPlatform = current;
    }

    if (current.id === finishPlat.id) {
      return {
        completable: true,
        visitedIds: visited,
        furthestPlatformId: finishPlat.id,
        furthestX: finishPlat.baseX + finishPlat.w,
        minYReached: finishPlat.baseY,
      };
    }

    for (const candidate of stage.platforms) {
      if (visited.has(candidate.id)) continue;
      if (canJumpBetween(current, candidate, stage.bouncePads, stage.hazards)) {
        visited.add(candidate.id);
        queue.push(candidate);
      }
    }
  }

  return {
    completable: false,
    visitedIds: visited,
    furthestPlatformId: furthestPlatform.id,
    furthestX: furthestPlatform.baseX + furthestPlatform.w,
    minYReached: furthestPlatform.baseY,
  };
}

interface PathSegmentSpec {
  dir: 1 | -1;
  steps: number;
  waveAmp: number;
}

/**
 * Builds a dynamic 'S'-shaped serpentine sequence of path segments.
 * Higher stages produce more switchback curves ('S' turns) and stronger vertical waves.
 */
function buildDynamicSPathPlan(
  safeStage: number,
  rng: () => number,
  lengthSetting: MatchSettings['classicStageLength'] = 'standard'
): PathSegmentSpec[] {
  const baseCurves = clamp(1 + Math.floor((safeStage - 1) / 2), 1, 5);
  const numSCurves =
    lengthSetting === 'short'
      ? Math.max(1, baseCurves - 1)
      : lengthSetting === 'long'
      ? Math.min(6, baseCurves + 1)
      : baseCurves;
  const segments: PathSegmentSpec[] = [];

  for (let i = 0; i < numSCurves; i++) {
    // Rightward leg
    segments.push({
      dir: 1,
      steps: randInt(rng, 4, 6 + Math.min(2, Math.floor(safeStage / 4))),
      waveAmp: 18 + Math.min(32, safeStage * 4),
    });
    // Leftward switchback leg (forms the middle bar of the 'S' while climbing!)
    segments.push({
      dir: -1,
      steps: randInt(rng, 2, 2 + Math.min(2, Math.floor(safeStage / 4))),
      waveAmp: 14 + Math.min(24, safeStage * 3),
    });
  }

  // Final rightward sprint leg toward the elevated finish
  segments.push({
    dir: 1,
    steps: randInt(rng, 4, 6 + Math.min(3, Math.floor(safeStage / 4))),
    waveAmp: 20 + Math.min(30, safeStage * 4),
  });

  return segments;
}

/**
 * Generates an infinite, progressively longer & higher-climbing procedural stage
 * with dynamic 'S'-shaped serpentine paths, scattered visible item boxes, conveyors,
 * crumbling platforms, wind updrafts, moving platforms, springs, boost rings, bumpers,
 * energy crystals, and hazards.
 */
export function generateStage(
  stageNumber: number,
  seed: number,
  settings?: Partial<MatchSettings>
): StageData {
  const safeStage = Math.max(1, Math.floor(stageNumber));
  const biome =
    settings?.classicBiome && settings.classicBiome !== 'auto'
      ? settings.classicBiome
      : getBiomeForStage(safeStage);
  const combinedSeed = (seed ^ Math.imul(safeStage, 2654435761)) >>> 0;
  const rng = createRng(combinedSeed);

  const lengthFactor =
    settings?.classicStageLength === 'short'
      ? 0.68
      : settings?.classicStageLength === 'long'
      ? 1.38
      : 1.0;

  const horizontalTarget = Math.round(
    (2500 + Math.min(safeStage - 1, 15) * 680 + Math.max(0, safeStage - 16) * 420) *
      lengthFactor
  );
  const targetClimb = Math.round((320 + (safeStage - 1) * 260) * lengthFactor);

  const complexity = clamp((safeStage - 1) / 10, 0, 1);
  const movingProb = 0.1 + complexity * 0.18;
  const conveyorProb = 0.12 + complexity * 0.12;
  const crumblingProb = 0.1 + complexity * 0.12;
  const springProb = 0.16 + complexity * 0.14;
  const hazardProb =
    settings?.hazardsEnabled === false ? 0 : 0.15 + complexity * 0.3;
  const windProb = biome === 'wind_tower' ? 0.28 : 0.14 + complexity * 0.08;
  const itemFreq = settings?.itemFrequency ?? 'normal';

  let nextId = 1;
  let pathCounter = 0;
  let boxCounter = 0;

  const platforms: Platform[] = [];
  const bouncePads: BouncePad[] = [];
  const boostRings: BoostRing[] = [];
  const bumpers: Bumper[] = [];
  const crystals: Crystal[] = [];
  const windZones: WindZone[] = [];
  const hazards: Hazard[] = [];
  const itemBoxes: ItemBox[] = [];

  const spawnItemBox = (x: number, y: number) => {
    if (itemFreq === 'none') return;
    boxCounter++;
    itemBoxes.push({
      id: nextId++,
      x: Math.round(x),
      y: Math.round(y),
      itemType: pickScatteredItemType(rng, boxCounter),
      respawnAt: 0,
    });
  };

  const startPlat: Platform = {
    id: nextId++,
    x: 40,
    y: 0,
    baseX: 40,
    baseY: 0,
    w: 320,
    h: 36,
    kind: 'start',
    pathIndex: pathCounter++,
    nextDir: 1,
  };
  platforms.push(startPlat);

  // Place an early visible item box near the end of the start platform so players can test items right away
  spawnItemBox(startPlat.baseX + startPlat.w - 68, startPlat.baseY - 46);

  let cur = startPlat;
  let stepIndex = 0;

  const segments = buildDynamicSPathPlan(safeStage, rng, settings?.classicStageLength);

  const appendStepPlatform = (
    dir: 1 | -1,
    isTurnApex: boolean,
    isPostTurnClimb: boolean,
    waveAmp: number
  ) => {
    stepIndex++;
    cur.nextDir = dir;

    const remainingClimb = Math.max(0, cur.baseY - -targetClimb);

    // If this platform is the apex of an 'S' turn, make it a wide solid/checkpoint platform
    // with a BouncePad on its exit edge so the next platform can climb 155px cleanly!
    const useSpringHere =
      isTurnApex ||
      (!isPostTurnClimb &&
        (cur.kind === 'solid' || cur.kind === 'conveyor') &&
        remainingClimb > 140 &&
        rng() < springProb &&
        cur.w >= 130);

    if (useSpringHere && !isTurnApex) {
      const padX = dir === 1 ? cur.baseX + cur.w - 64 : cur.baseX + 20;
      bouncePads.push({
        id: nextId++,
        x: padX,
        y: cur.baseY - 14,
        w: 44,
        h: 14,
        power: SPRING_VELOCITY,
      });
    }

    let stepUp: number;
    let gapX: number;

    if (isPostTurnClimb) {
      // Climbing out of an S-curve turn apex with a bounce pad on `cur`
      stepUp = randInt(rng, 148, SAFE_SPRING_STEP_UP - 22);
      gapX = randInt(rng, 58, 92);
    } else if (isTurnApex) {
      stepUp = randInt(rng, 64, SAFE_MAX_STEP_UP - 10);
      gapX = randInt(rng, 54, 86);
    } else if (useSpringHere) {
      stepUp = randInt(rng, 125, SAFE_SPRING_STEP_UP - 22);
      gapX = randInt(rng, 68, 142);
    } else if (dir === -1) {
      // On leftward switchback legs, always climb steadily upward so the upper deck stays high above the lower deck
      stepUp = randInt(rng, 44, SAFE_MAX_STEP_UP - 10);
      gapX = randInt(rng, 58, 114);
    } else {
      // Rightward segment with dynamic vertical wave + steady climb
      const waveOffset = Math.round(Math.sin(stepIndex * 1.15) * waveAmp);
      const baseClimb = remainingClimb > 100 ? randInt(rng, 22, 54) : randInt(rng, 8, 34);
      stepUp = clamp(baseClimb + waveOffset, -38, SAFE_MAX_STEP_UP - 10);
      const maxSafeGap = Math.floor(SAFE_MAX_HORIZONTAL_GAP - 0.58 * Math.max(0, stepUp) - 20);
      gapX = randInt(rng, 66, Math.max(88, maxSafeGap));
    }

    // Cap horizontal gap if leaving an opposing conveyor
    const conveyorOpposes =
      cur.kind === 'conveyor' &&
      ((dir === 1 && (cur.conveyorSpeed ?? 0) < 0) ||
        (dir === -1 && (cur.conveyorSpeed ?? 0) > 0));
    if (conveyorOpposes) {
      gapX = Math.min(gapX, 96);
    }

    const minW = Math.round(138 - complexity * 24);
    const maxW = Math.round(235 - complexity * 50);
    let platW = randInt(rng, minW, maxW);

    const isCheckpoint = isTurnApex || stepIndex % 5 === 0;
    if (isCheckpoint || isPostTurnClimb) {
      platW = Math.max(platW, 185);
    }

    const allowSpecialKind = !isCheckpoint && !isTurnApex && !isPostTurnClimb && !useSpringHere;
    const roll = rng();
    const isMoving =
      allowSpecialKind &&
      cur.kind !== 'moving' &&
      stepIndex >= 2 &&
      roll < movingProb;
    const isConveyor =
      allowSpecialKind &&
      !isMoving &&
      stepIndex >= 2 &&
      roll >= movingProb &&
      roll < movingProb + conveyorProb;
    const isCrumbling =
      allowSpecialKind &&
      !isMoving &&
      !isConveyor &&
      stepIndex >= 3 &&
      roll >= movingProb + conveyorProb &&
      roll < movingProb + conveyorProb + crumblingProb;

    const actualW = isMoving
      ? Math.max(115, Math.min(platW, 155))
      : isConveyor
      ? Math.max(145, platW)
      : isCrumbling
      ? Math.max(118, Math.min(platW, 148))
      : platW;

    const newBaseX =
      dir === 1
        ? cur.baseX + cur.w + gapX
        : cur.baseX - gapX - actualW;
    const newBaseY = cur.baseY - stepUp;

    let plat: Platform;
    if (isMoving) {
      const moveAxis: 'x' | 'y' =
        remainingClimb > 120 && rng() < 0.5 ? 'y' : 'x';
      const moveRange =
        moveAxis === 'x' ? randInt(rng, 28, 52) : randInt(rng, 24, 42);
      const adjustedBaseX =
        moveAxis === 'x'
          ? dir === 1
            ? cur.baseX + cur.w + Math.min(gapX, 76) + moveRange + 14
            : cur.baseX - Math.min(gapX, 76) - moveRange - 14 - actualW
          : newBaseX;

      plat = {
        id: nextId++,
        x: adjustedBaseX,
        y: newBaseY,
        baseX: adjustedBaseX,
        baseY: newBaseY,
        w: actualW,
        h: 26,
        kind: 'moving',
        moveAxis,
        moveRange,
        moveSpeed: randRange(rng, 1.3, 2.0 + complexity * 0.65),
        movePhase: randRange(rng, 0, Math.PI * 2),
        pathIndex: pathCounter++,
        nextDir: dir,
      };
    } else if (isConveyor) {
      const convDir = rng() < 0.68 ? dir : (-dir as 1 | -1);
      plat = {
        id: nextId++,
        x: newBaseX,
        y: newBaseY,
        baseX: newBaseX,
        baseY: newBaseY,
        w: actualW,
        h: 28,
        kind: 'conveyor',
        conveyorSpeed: convDir * (115 + complexity * 45),
        pathIndex: pathCounter++,
        nextDir: dir,
      };
    } else if (isCrumbling) {
      plat = {
        id: nextId++,
        x: newBaseX,
        y: newBaseY,
        baseX: newBaseX,
        baseY: newBaseY,
        w: actualW,
        h: 24,
        kind: 'crumbling',
        crumbleState: 'intact',
        crumbleTimer: 0,
        pathIndex: pathCounter++,
        nextDir: dir,
      };
    } else {
      plat = {
        id: nextId++,
        x: newBaseX,
        y: newBaseY,
        baseX: newBaseX,
        baseY: newBaseY,
        w: actualW,
        h: 28,
        kind: isCheckpoint ? 'checkpoint' : 'solid',
        pathIndex: pathCounter++,
        nextDir: dir,
      };
    }

    platforms.push(plat);

    // Parabolic Crystal Arches across gaps (works for both rightward and leftward S-curve jumps)
    if (stepIndex % 2 === 1 || rng() < 0.5) {
      const startArcX = dir === 1 ? cur.baseX + cur.w - 10 : cur.baseX + 10;
      const endArcX = dir === 1 ? plat.baseX + 18 : plat.baseX + plat.w - 18;
      const midArcY = Math.min(cur.baseY, plat.baseY) - 54;
      for (let cIdx = 0; cIdx < 3; cIdx++) {
        const t = (cIdx + 1) / 4;
        const cxPos = startArcX + (endArcX - startArcX) * t;
        const arcLift = Math.sin(t * Math.PI) * 34;
        const baseLerpY = cur.baseY + (plat.baseY - cur.baseY) * t - 28;
        crystals.push({
          id: nextId++,
          x: Math.round(cxPos),
          y: Math.round(Math.min(baseLerpY - arcLift, midArcY + (1 - Math.sin(t * Math.PI)) * 22)),
          respawnAt: 0,
        });
      }
    }

    // Gap center X between `cur` and `plat`
    const gapCenterX =
      dir === 1
        ? cur.baseX + cur.w + gapX * 0.5
        : plat.baseX + plat.w + gapX * 0.5;

    // Boost Rings in mid-air across gaps
    const hasBoostRing =
      !useSpringHere &&
      !isPostTurnClimb &&
      gapX >= 74 &&
      (stepIndex === 2 || rng() < 0.34);
    if (hasBoostRing) {
      boostRings.push({
        id: nextId++,
        x: Math.round(gapCenterX),
        y: Math.round(Math.min(cur.baseY, plat.baseY) - 46),
        r: 22,
        boostVx: dir * 470,
        boostVy: -350,
      });
    }

    // Electromagnetic Pinball Bumpers above platforms (never blocking a spring pad launch)
    if (!hasBoostRing && !useSpringHere && !isTurnApex && !isPostTurnClimb && (stepIndex === 3 || rng() < 0.28)) {
      bumpers.push({
        id: nextId++,
        x: Math.round(plat.baseX + plat.w * (0.28 + rng() * 0.44)),
        y: Math.round(plat.baseY - 94),
        r: 17,
      });
    }

    // SCATTERED ITEM BOXES across diverse positions (edges, mid-air jump arcs, high above springs/bumpers, flanking ledges)
    if (itemFreq === 'frenzy' || stepIndex % 2 === 1 || rng() < 0.55) {
      const placementStyle = (stepIndex + Math.floor(rng() * 3)) % 4;
      if (placementStyle === 0) {
        // Near platform entry or exit edge (not center!)
        const onEntryEdge = rng() < 0.5;
        const edgeX = onEntryEdge
          ? plat.baseX + randInt(rng, 14, 34)
          : plat.baseX + plat.w - randInt(rng, 44, 62);
        spawnItemBox(edgeX, plat.baseY - randInt(rng, 42, 58));
      } else if (placementStyle === 1) {
        // Suspended in mid-air across the jump gap between cur and plat!
        const airY = Math.min(cur.baseY, plat.baseY) - randInt(rng, 56, 84);
        spawnItemBox(gapCenterX - 15, airY);
      } else if (placementStyle === 2) {
        // High above the platform (reachable via high jump / bumper / spring / air-dash)
        const highOffsetRatio = rng() < 0.5 ? 0.22 : 0.78;
        spawnItemBox(
          plat.baseX + plat.w * highOffsetRatio - 15,
          plat.baseY - randInt(rng, 88, 122)
        );
      } else {
        // Dual scattered boxes on wider platforms (one low on one side, one high on the other side)
        spawnItemBox(plat.baseX + 20, plat.baseY - 44);
        if (plat.w >= 165) {
          spawnItemBox(plat.baseX + plat.w - 50, plat.baseY - 82);
        }
      }
      if (itemFreq === 'frenzy' && plat.w >= 140) {
        spawnItemBox(plat.baseX + Math.round(plat.w * 0.5) - 15, plat.baseY - 54);
      }
    }

    // Wind Updraft Column in gaps or at S-curve vertical climbs
    if (isPostTurnClimb || (!hasBoostRing && rng() < windProb && gapX >= 62)) {
      const windX =
        dir === 1 ? cur.baseX + cur.w + 6 : plat.baseX + plat.w + 6;
      windZones.push({
        id: nextId++,
        x: windX,
        y: Math.min(cur.baseY, plat.baseY) - 210,
        w: Math.max(52, gapX - 12),
        h: 255,
        forceY: -2250,
      });
    }

    // Hazards ONLY on wide solid non-turn platforms
    if (
      plat.kind === 'solid' &&
      !isTurnApex &&
      !isPostTurnClimb &&
      plat.w >= 170 &&
      stepIndex >= 2 &&
      rng() < hazardProb
    ) {
      const hazardMargin = 62;
      const availableW = plat.w - hazardMargin * 2;
      if (availableW >= 36) {
        const hazardRoll = rng();
        if (hazardRoll < 0.36) {
          const droneX = plat.baseX + plat.w * 0.5 - 14;
          const droneBaseY = plat.baseY - 62;
          hazards.push({
            id: nextId++,
            kind: 'drone',
            x: droneX,
            baseX: droneX,
            y: droneBaseY,
            baseY: droneBaseY,
            w: 28,
            h: 20,
            radius: 14,
            patrolRange: 18,
            patrolSpeed: randRange(rng, 2.0, 2.8),
          });
        } else if (safeStage >= 2 && hazardRoll < 0.68) {
          hazards.push({
            id: nextId++,
            kind: 'laser',
            x: plat.baseX + plat.w * 0.5 - 8,
            baseX: plat.baseX + plat.w * 0.5 - 8,
            y: plat.baseY - 76,
            w: 16,
            h: 76,
            radius: 8,
            cyclePeriod: randRange(rng, 2.2, 3.0),
            cycleOffset: randRange(rng, 0, 3.0),
          });
        } else {
          const sawR = 16;
          const sawStartX = plat.baseX + plat.w * 0.5 - sawR;
          hazards.push({
            id: nextId++,
            kind: 'saw',
            x: sawStartX,
            baseX: sawStartX,
            y: plat.baseY - sawR,
            w: sawR * 2,
            h: sawR * 2,
            radius: sawR,
            patrolRange: Math.min(28, availableW * 0.35),
            patrolSpeed: randRange(rng, 1.8, 2.8),
          });
        }
      }
    }

    // Optional flanking / upper shortcut platform with scattered item boxes
    if (plat.kind === 'solid' && !isTurnApex && stepIndex > 2 && rng() < 0.32 && plat.w >= 160) {
      const bonusY = plat.baseY - randInt(rng, 68, 84);
      const bonusX =
        dir === 1
          ? plat.baseX + randInt(rng, 12, Math.max(20, plat.w - 110))
          : plat.baseX + randInt(rng, 12, Math.max(20, plat.w - 110));
      const bonusW = randInt(rng, 96, 128);
      const bonusPlat: Platform = {
        id: nextId++,
        x: bonusX,
        y: bonusY,
        baseX: bonusX,
        baseY: bonusY,
        w: bonusW,
        h: 20,
        kind: 'solid',
        pathIndex: plat.pathIndex !== undefined ? plat.pathIndex + 0.4 : undefined,
        nextDir: dir,
      };
      platforms.push(bonusPlat);
      // Place item box near the outer edge of the bonus platform
      const boxOnLeft = rng() < 0.5;
      spawnItemBox(
        boxOnLeft ? bonusPlat.baseX + 14 : bonusPlat.baseX + bonusPlat.w - 44,
        bonusPlat.baseY - 46
      );
    }

    cur = plat;
  };

  // Execute the dynamic 'S'-curve segment plan
  for (let sIdx = 0; sIdx < segments.length; sIdx++) {
    const seg = segments[sIdx];
    const nextSeg = segments[sIdx + 1];
    const stepsToRun = sIdx === 0 ? seg.steps : Math.max(1, seg.steps - 1);

    for (let step = 0; step < stepsToRun; step++) {
      const wouldGoTooFarLeft = seg.dir === -1 && cur.baseX < 460;
      const isLastStepBeforeTurn = Boolean(
        nextSeg && (step === stepsToRun - 1 || wouldGoTooFarLeft)
      );
      appendStepPlatform(seg.dir, isLastStepBeforeTurn, false, seg.waveAmp);
      if (wouldGoTooFarLeft) {
        break;
      }
    }

    if (nextSeg && nextSeg.dir !== seg.dir) {
      // `cur` is the Apex Turn Platform. Place a Bounce Pad on the side facing `nextSeg.dir`
      // so the robot launches 155px+ vertically into the reversed direction leg!
      const springX =
        nextSeg.dir === -1 ? cur.baseX + 22 : cur.baseX + cur.w - 66;
      bouncePads.push({
        id: nextId++,
        x: springX,
        y: cur.baseY - 14,
        w: 44,
        h: 14,
        power: SPRING_VELOCITY,
      });
      // Also place an item box on the outer corner of the S-turn apex!
      const cornerBoxX =
        nextSeg.dir === -1 ? cur.baseX + cur.w - 48 : cur.baseX + 18;
      spawnItemBox(cornerBoxX, cur.baseY - 52);

      // First step in the reversed direction climbs steeply using the Bounce Pad
      appendStepPlatform(nextSeg.dir, false, true, nextSeg.waveAmp);
    }
  }

  // Continue extending rightward & upward until both horizontalTarget and targetClimb are met
  while (
    (cur.baseX + cur.w < horizontalTarget || cur.baseY > -targetClimb + 80) &&
    stepIndex < 600
  ) {
    appendStepPlatform(1, false, false, 22);
  }

  while (cur.baseY > -targetClimb + 55 && stepIndex < 650) {
    stepIndex++;
    cur.nextDir = 1;
    const stepUp = Math.min(SAFE_MAX_STEP_UP - 12, cur.baseY - -targetClimb);
    const gapX = randInt(rng, 58, 104);
    const stepPlat: Platform = {
      id: nextId++,
      x: cur.baseX + cur.w + gapX,
      y: cur.baseY - Math.max(40, stepUp),
      baseX: cur.baseX + cur.w + gapX,
      baseY: cur.baseY - Math.max(40, stepUp),
      w: 150,
      h: 28,
      kind: 'solid',
      pathIndex: pathCounter++,
      nextDir: 1,
    };
    platforms.push(stepPlat);
    cur = stepPlat;
  }

  cur.nextDir = 1;
  const finishY = Math.min(cur.baseY - 45, -targetClimb);
  const finishPlat: Platform = {
    id: nextId++,
    x: cur.baseX + cur.w + 88,
    y: finishY,
    baseX: cur.baseX + cur.w + 88,
    baseY: finishY,
    w: 280,
    h: 36,
    kind: 'finish',
    pathIndex: pathCounter++,
    nextDir: 1,
  };
  platforms.push(finishPlat);

  const maxRightX = platforms.reduce((acc, p) => Math.max(acc, p.baseX + p.w), finishPlat.baseX + finishPlat.w);

  const stage: StageData = {
    stageNumber: safeStage,
    biome,
    seed: combinedSeed,
    startX: startPlat.baseX + 60,
    startY: startPlat.baseY - ROBOT_H,
    finishX: finishPlat.baseX + 110,
    finishY: finishPlat.baseY - 96,
    finishW: 64,
    finishH: 96,
    targetClimb: Math.round(-finishPlat.baseY),
    horizontalSpan: Math.round(maxRightX - startPlat.baseX),
    abyssY: 460,
    platforms,
    bouncePads,
    boostRings,
    bumpers,
    crystals,
    windZones,
    hazards,
    itemBoxes,
  };

  let report = verifyStageCompletable(stage);
  let repairAttempts = 0;

  while (!report.completable && repairAttempts < 45) {
    repairAttempts++;
    const frontier =
      stage.platforms.find((p) => p.id === report.furthestPlatformId) ?? startPlat;
    if (frontier.kind === 'conveyor') {
      frontier.conveyorSpeed = (frontier.nextDir ?? 1) * Math.abs(frontier.conveyorSpeed ?? 115);
    }
    const frontierSweep = getPlatformSweep(frontier);

    stage.hazards = stage.hazards.filter(
      (h) =>
        h.baseX + h.w < frontierSweep.minX ||
        h.baseX > frontierSweep.maxX
    );

    // Find the next main-path platform after `frontier`
    const targetNext =
      stage.platforms.find(
        (p) => (p.pathIndex ?? 0) >= Math.floor(frontier.pathIndex ?? 0) + 1
      ) ?? finishPlat;
    const targetSweep = getPlatformSweep(targetNext);
    stage.hazards = stage.hazards.filter(
      (h) =>
        h.baseX + h.w < targetSweep.minX ||
        h.baseX > targetSweep.maxX
    );
    const goRight = targetSweep.minX >= frontierSweep.minX;

    const stepX = goRight
      ? frontierSweep.maxX + 54
      : frontierSweep.minX - 54 - 135;
    const neededClimb = frontierSweep.minY - targetSweep.minY;
    const stepUp = clamp(neededClimb * 0.5, -35, SAFE_MAX_STEP_UP - 18);

    const bridge: Platform = {
      id: nextId++,
      x: stepX,
      y: frontierSweep.minY - stepUp,
      baseX: stepX,
      baseY: frontierSweep.minY - stepUp,
      w: 135,
      h: 26,
      kind: 'solid',
      pathIndex: (frontier.pathIndex ?? 0) + 0.01,
      nextDir: goRight ? 1 : -1,
    };
    stage.platforms.splice(stage.platforms.length - 1, 0, bridge);
    report = verifyStageCompletable(stage);
  }

  return stage;
}
