import {
  AIR_ACCEL,
  AIR_DECEL,
  ALL_ITEM_TYPES,
  BASE_RUN_SPEED,
  COYOTE_TIME,
  DASH_DURATION,
  DASH_SPEED,
  GRAVITY,
  GROUND_ACCEL,
  GROUND_DECEL,
  JUMP_BUFFER_TIME,
  JUMP_CUT_FACTOR,
  JUMP_VELOCITY,
  MAX_FALL_SPEED,
  ROBOT_CLASSES,
  ROBOT_H,
  ROBOT_W,
} from './constants';
import type {
  GameEvent,
  GameMode,
  ItemType,
  MatchState,
  Platform,
  PlayerInput,
  RobotClassId,
  RobotState,
  StageData,
} from './types';

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function aabbOverlap(
  ax: number,
  ay: number,
  aw: number,
  ah: number,
  bx: number,
  by: number,
  bw: number,
  bh: number
): boolean {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

export function isLaserActive(
  cyclePeriod: number = 2.6,
  cycleOffset: number = 0,
  simTime: number
): boolean {
  const phase = ((simTime + cycleOffset) % cyclePeriod + cyclePeriod) % cyclePeriod;
  return phase < cyclePeriod * 0.46;
}

export function updateStageDynamics(
  stage: StageData,
  simTime: number
): Map<number, { dx: number; dy: number; prevY: number }> {
  const deltas = new Map<number, { dx: number; dy: number; prevY: number }>();

  for (const p of stage.platforms) {
    const prevX = p.x;
    const prevY = p.y;
    if (p.kind === 'moving' && p.moveRange && p.moveSpeed) {
      const offset = Math.sin(simTime * p.moveSpeed + (p.movePhase ?? 0)) * p.moveRange;
      if (p.moveAxis === 'x') {
        p.x = p.baseX + offset;
        p.y = p.baseY;
      } else {
        p.x = p.baseX;
        p.y = p.baseY + offset;
      }
    }
    deltas.set(p.id, { dx: p.x - prevX, dy: p.y - prevY, prevY });
  }

  for (const h of stage.hazards) {
    if (h.kind === 'saw' && h.patrolRange && h.patrolSpeed) {
      h.x = h.baseX + Math.sin(simTime * h.patrolSpeed) * h.patrolRange;
    } else if (
      h.kind === 'drone' &&
      h.baseY !== undefined &&
      h.patrolRange &&
      h.patrolSpeed
    ) {
      h.y = h.baseY + Math.sin(simTime * h.patrolSpeed) * h.patrolRange;
    }
  }

  return deltas;
}

export function computeRobotProgress(robot: RobotState, stage: StageData): number {
  if (robot.finished) return 100;
  const rawDx = stage.finishX - stage.startX;
  const rawDy = stage.finishY - stage.startY;
  const dx =
    Math.abs(rawDx) > 20
      ? clamp((robot.x - stage.startX) / rawDx, 0, 1)
      : 1;
  const dy =
    Math.abs(rawDy) > 20
      ? clamp((robot.y - stage.startY) / rawDy, 0, 1)
      : 1;

  // Check if stage platforms carry sequential pathIndex for 'S'-shaped serpentine paths
  let maxPathIdx = 0;
  let closestPathIdx = -1;
  let bestDist = Infinity;
  const rcx = robot.x + robot.w * 0.5;
  const rBottom = robot.y + robot.h;

  for (const p of stage.platforms) {
    if (p.pathIndex !== undefined && p.pathIndex > maxPathIdx) {
      maxPathIdx = p.pathIndex;
    }
    if (p.pathIndex !== undefined) {
      const pcx = p.x + p.w * 0.5;
      const dist = Math.hypot(rcx - pcx, (rBottom - p.y) * 1.35);
      if (dist < bestDist) {
        bestDist = dist;
        closestPathIdx = p.pathIndex;
      }
    }
  }

  if (maxPathIdx > 0 && closestPathIdx >= 0) {
    const pathRatio = clamp(closestPathIdx / maxPathIdx, 0, 1);
    return Math.round(clamp(pathRatio * 0.58 + dy * 0.24 + dx * 0.18, 0, 0.99) * 100);
  }

  return Math.round(clamp(dx * 0.68 + dy * 0.32, 0, 0.99) * 100);
}

/**
 * Computes the dynamic vertical fall limit Y for a robot.
 * Ensures that when the Finish Portal (objective) or reachable platforms/mechanics
 * are located below the robot (e.g. diving down to a lower objective in Editor Mode),
 * the system never triggers a premature fall reset above the objective or lower platforms.
 */
export function computeRobotFallLimitY(
  robot: RobotState,
  stage: StageData,
  gameMode?: GameMode
): number {
  let fallReferenceY = Math.min(robot.lastSafeY, robot.checkpointY);

  // 1. Always allow falling all the way down to the Finish Portal (objective) if it is below
  const finishBottomY = stage.finishY + stage.finishH;
  if (finishBottomY > fallReferenceY) {
    fallReferenceY = Math.max(fallReferenceY, finishBottomY + 60);
  }

  // 2. Check if this stage is an Editor Mode map or has any downward elements below Start
  const hasElementsBelowStart =
    finishBottomY > stage.startY + 60 ||
    stage.platforms.some((p) => p.baseY > stage.startY + 60) ||
    stage.bouncePads.some((b) => b.y > stage.startY + 60) ||
    stage.boostRings.some((r) => r.y > stage.startY + 60) ||
    stage.windZones.some((w) => w.y + w.h > stage.startY + 60);

  if (gameMode === 'editor' || hasElementsBelowStart) {
    let lowestStageTargetY = finishBottomY;
    for (const p of stage.platforms) {
      if (p.kind === 'crumbling' && p.crumbleState === 'fallen') continue;
      lowestStageTargetY = Math.max(lowestStageTargetY, p.y + p.h);
    }
    for (const pad of stage.bouncePads) {
      lowestStageTargetY = Math.max(lowestStageTargetY, pad.y + pad.h);
    }
    for (const wz of stage.windZones) {
      lowestStageTargetY = Math.max(lowestStageTargetY, wz.y + wz.h);
    }
    for (const ring of stage.boostRings) {
      lowestStageTargetY = Math.max(lowestStageTargetY, ring.y + ring.r);
    }
    for (const bmp of stage.bumpers) {
      lowestStageTargetY = Math.max(lowestStageTargetY, bmp.y + bmp.r);
    }
    for (const box of stage.itemBoxes) {
      lowestStageTargetY = Math.max(lowestStageTargetY, box.y + 30);
    }
    for (const cry of stage.crystals) {
      lowestStageTargetY = Math.max(lowestStageTargetY, cry.y + 20);
    }
    fallReferenceY = Math.max(fallReferenceY, lowestStageTargetY + 60);
  }

  const effectiveAbyssY = Math.max(stage.abyssY, fallReferenceY + 260);
  return Math.min(effectiveAbyssY, fallReferenceY + 250);
}

export function getSortedRacers(robots: RobotState[]): RobotState[] {
  return [...robots].sort((a, b) => {
    if (a.finished && b.finished) {
      return (a.finishRank ?? 99) - (b.finishRank ?? 99);
    }
    if (a.finished) return -1;
    if (b.finished) return 1;
    if (b.progress !== a.progress) return b.progress - a.progress;
    return b.x - a.x;
  });
}

function getSafePlatformSpawnX(plat: Platform, stage: StageData): number {
  const centerSpawnX = plat.baseX + plat.w * 0.5 - ROBOT_W * 0.5;
  const hasCenterHazard = stage.hazards.some(
    (h) =>
      h.baseX + h.w > centerSpawnX - 8 &&
      h.baseX < centerSpawnX + ROBOT_W + 8 &&
      Math.abs(h.y + h.h - plat.baseY) <= 84
  );
  if (!hasCenterHazard) {
    return plat.x + plat.w * 0.5 - ROBOT_W * 0.5;
  }
  return plat.x + 14;
}

export function pickWeightedItem(
  robot: RobotState,
  sortedRacers: RobotState[],
  rngRoll: () => number
): ItemType {
  const total = sortedRacers.length;
  const rankIdx = sortedRacers.findIndex((r) => r.id === robot.id);

  let pool: ItemType[];
  if (total >= 2 && rankIdx === 0) {
    // 1st place: tactical defense, barriers, grease traps, frost mines, and mild boosts (never runaway Warp or Magnet)
    pool = ['barrier', 'grease', 'frost', 'shield', 'shield', 'emp', 'turbo', 'whirlwind'];
  } else if (total >= 2 && rankIdx === total - 1) {
    // Last place: high comeback potential (never passive Frost/Grease trap)
    pool = ['warp', 'jetpack', 'jetpack', 'turbo', 'whirlwind', 'magnet', 'rocket', 'glitch', 'shield'];
  } else if (total >= 3 && rankIdx >= Math.ceil(total * 0.5)) {
    // Back half of pack
    pool = ['warp', 'jetpack', 'turbo', 'whirlwind', 'magnet', 'rocket', 'glitch', 'shield', 'emp', 'barrier'];
  } else {
    // Middle pack
    pool = ALL_ITEM_TYPES;
  }

  const idx = Math.floor(Math.max(0, rngRoll()) * pool.length) % pool.length;
  return pool[idx];
}

function emitEvent(
  match: MatchState,
  event: Omit<GameEvent, 'id'>
): void {
  match.events.push({
    ...event,
    id: match.nextEntityId++,
  });
}

function absorbOrHurt(
  match: MatchState,
  robot: RobotState,
  knockVx: number,
  knockVy: number,
  stunDuration: number,
  eventType: 'hurt' | 'rocket_hit' | 'frost_hit' | 'barrier_hit'
): void {
  if (robot.shieldTimer > 0) {
    robot.shieldTimer = 0;
    robot.invulnTimer = 1.1;
    emitEvent(match, {
      type: 'shield',
      x: robot.x + robot.w * 0.5,
      y: robot.y + robot.h * 0.5,
      actorId: robot.id,
      actorName: robot.name,
      colorIndex: robot.colorIndex,
    });
    return;
  }

  if (robot.invulnTimer > 0) return;

  const cls = ROBOT_CLASSES[robot.robotClass] ?? ROBOT_CLASSES.balanced;
  robot.vx = knockVx * cls.knockbackResist;
  robot.vy = knockVy * cls.knockbackResist;
  robot.stunTimer = Math.max(robot.stunTimer, stunDuration * cls.knockbackResist);
  robot.invulnTimer = 1.4;
  robot.scaleX = 1.25;
  robot.scaleY = 0.75;

  emitEvent(match, {
    type: eventType,
    x: robot.x + robot.w * 0.5,
    y: robot.y + robot.h * 0.5,
    actorId: robot.id,
    actorName: robot.name,
    colorIndex: robot.colorIndex,
  });
}

export function activateRobotItem(
  match: MatchState,
  robot: RobotState
): void {
  const item = robot.heldItem;
  if (!item || robot.finished) return;
  robot.heldItem = null;

  const cx = robot.x + robot.w * 0.5;
  const cy = robot.y + robot.h * 0.5;
  const sorted = getSortedRacers(match.robots);
  const leader = sorted.find((r) => r.id !== robot.id && !r.finished);

  switch (item) {
    case 'turbo': {
      robot.turboTimer = 3.2;
      robot.vx = robot.facing * BASE_RUN_SPEED * 1.55;
      emitEvent(match, {
        type: 'turbo',
        x: cx,
        y: cy,
        actorId: robot.id,
        actorName: robot.name,
        colorIndex: robot.colorIndex,
      });
      break;
    }
    case 'shield': {
      robot.shieldTimer = 6.0;
      emitEvent(match, {
        type: 'shield',
        x: cx,
        y: cy,
        actorId: robot.id,
        actorName: robot.name,
        colorIndex: robot.colorIndex,
      });
      break;
    }
    case 'emp': {
      emitEvent(match, {
        type: 'emp',
        x: cx,
        y: cy,
        actorId: robot.id,
        actorName: robot.name,
        targetName: leader?.name,
        colorIndex: robot.colorIndex,
      });
      for (const rival of match.robots) {
        if (rival.id === robot.id || rival.finished) continue;
        const dist = Math.hypot(rival.x - robot.x, rival.y - robot.y);
        const isLeader = leader && rival.id === leader.id;
        if (dist <= 360 || isLeader) {
          if (rival.shieldTimer > 0) {
            rival.shieldTimer = 0;
            rival.invulnTimer = 1.0;
          } else {
            rival.empSlowTimer = 2.4;
            rival.vy = Math.max(rival.vy, 120);
          }
        }
      }
      break;
    }
    case 'rocket': {
      let target: RobotState | undefined = match.robots
        .filter((r) => r.id !== robot.id && !r.finished && (r.progress >= robot.progress || r.x >= robot.x - 40))
        .sort((a, b) => Math.hypot(a.x - robot.x, a.y - robot.y) - Math.hypot(b.x - robot.x, b.y - robot.y))[0];

      if (!target) {
        target = leader;
      }

      const dirX = target ? Math.sign(target.x - robot.x) || robot.facing : robot.facing;
      match.projectiles.push({
        id: match.nextEntityId++,
        ownerId: robot.id,
        kind: 'rocket',
        x: cx + dirX * 20,
        y: cy - 4,
        vx: dirX * 520,
        vy: 0,
        targetId: target ? target.id : null,
        ttl: 4.5,
      });
      emitEvent(match, {
        type: 'rocket_launch',
        x: cx,
        y: cy,
        actorId: robot.id,
        actorName: robot.name,
        targetName: target?.name,
        colorIndex: robot.colorIndex,
      });
      break;
    }
    case 'frost': {
      match.traps.push({
        id: match.nextEntityId++,
        ownerId: robot.id,
        kind: 'frost_mine',
        x: cx - 16,
        y: robot.y + robot.h - 14,
        radius: 22,
        ttl: 18.0,
      });
      emitEvent(match, {
        type: 'frost_drop',
        x: cx,
        y: robot.y + robot.h,
        actorId: robot.id,
        actorName: robot.name,
        colorIndex: robot.colorIndex,
      });
      break;
    }
    case 'barrier': {
      const barrierW = 22;
      const barrierH = 72;
      const bx = cx - robot.facing * 26 - barrierW * 0.5;
      const by = robot.y + robot.h - barrierH;
      match.traps.push({
        id: match.nextEntityId++,
        ownerId: robot.id,
        kind: 'barrier',
        x: bx,
        y: by,
        radius: 34,
        w: barrierW,
        h: barrierH,
        ttl: 14.0,
      });
      emitEvent(match, {
        type: 'barrier_drop',
        x: bx + barrierW * 0.5,
        y: by + barrierH * 0.5,
        actorId: robot.id,
        actorName: robot.name,
        colorIndex: robot.colorIndex,
      });
      break;
    }
    case 'grease': {
      const slickW = 84;
      const slickH = 12;
      const gx = cx - slickW * 0.5 - robot.facing * 18;
      const gy = robot.y + robot.h - 8;
      match.traps.push({
        id: match.nextEntityId++,
        ownerId: robot.id,
        kind: 'grease_slick',
        x: gx,
        y: gy,
        radius: 42,
        w: slickW,
        h: slickH,
        ttl: 16.0,
      });
      emitEvent(match, {
        type: 'grease_drop',
        x: cx,
        y: robot.y + robot.h,
        actorId: robot.id,
        actorName: robot.name,
        colorIndex: robot.colorIndex,
      });
      break;
    }
    case 'whirlwind': {
      // Launches the robot super high upward AND deploys a cyclone vortex that flings rivals way up into the air!
      const wwW = 48;
      const wwH = 82;
      const wx = cx - wwW * 0.5;
      const wy = robot.y + robot.h - wwH;
      match.traps.push({
        id: match.nextEntityId++,
        ownerId: robot.id,
        kind: 'whirlwind',
        x: wx,
        y: wy,
        radius: 34,
        w: wwW,
        h: wwH,
        ttl: 14.0,
      });

      // Immediately launch the activating robot high into the air
      robot.vy = -1080;
      robot.onGround = false;
      robot.coyoteTimer = 0;
      robot.carryingPlatformId = null;
      robot.dashCooldown = 0;
      robot.scaleX = 0.74;
      robot.scaleY = 1.32;

      // Also fling any rival right next to the cyclone high into the air immediately
      for (const rival of match.robots) {
        if (rival.id === robot.id || rival.finished) continue;
        if (Math.hypot(rival.x - robot.x, rival.y - robot.y) <= 110) {
          if (rival.shieldTimer > 0) {
            rival.shieldTimer = 0;
            rival.invulnTimer = 1.0;
          } else {
            rival.vy = -1120;
            rival.vx = -rival.facing * 220;
            rival.onGround = false;
            rival.carryingPlatformId = null;
            emitEvent(match, {
              type: 'whirlwind_hit',
              x: rival.x + rival.w * 0.5,
              y: rival.y + rival.h * 0.5,
              actorId: rival.id,
              actorName: rival.name,
              colorIndex: rival.colorIndex,
            });
          }
        }
      }

      emitEvent(match, {
        type: 'whirlwind_drop',
        x: cx,
        y: cy,
        actorId: robot.id,
        actorName: robot.name,
        colorIndex: robot.colorIndex,
      });
      break;
    }
    case 'magnet': {
      robot.vx = robot.facing * 500;
      robot.vy = -420;
      robot.onGround = false;
      const rivalAhead = sorted.find(
        (r) =>
          r.id !== robot.id &&
          !r.finished &&
          (r.progress > robot.progress || r.x > robot.x)
      );
      if (rivalAhead) {
        if (rivalAhead.shieldTimer > 0) {
          rivalAhead.shieldTimer = 0;
          rivalAhead.invulnTimer = 1.0;
        } else {
          rivalAhead.vx = -250;
          rivalAhead.vy = -240;
          rivalAhead.onGround = false;
          rivalAhead.empSlowTimer = Math.max(rivalAhead.empSlowTimer, 1.2);
        }
      }
      emitEvent(match, {
        type: 'magnet',
        x: cx,
        y: cy,
        actorId: robot.id,
        actorName: robot.name,
        targetId: rivalAhead?.id,
        targetName: rivalAhead?.name,
        colorIndex: robot.colorIndex,
      });
      break;
    }
    case 'glitch': {
      const glitchTarget =
        sorted.find(
          (r) =>
            r.id !== robot.id &&
            !r.finished &&
            (r.progress > robot.progress || r.x > robot.x)
        ) ?? leader;
      if (glitchTarget) {
        if (glitchTarget.shieldTimer > 0) {
          glitchTarget.shieldTimer = 0;
          glitchTarget.invulnTimer = 1.0;
        } else {
          glitchTarget.glitchTimer = 2.4;
        }
      }
      emitEvent(match, {
        type: 'glitch',
        x: cx,
        y: cy,
        actorId: robot.id,
        actorName: robot.name,
        targetId: glitchTarget?.id,
        targetName: glitchTarget?.name,
        colorIndex: robot.colorIndex,
      });
      break;
    }
    case 'warp': {
      // Find current pathIndex if available so Warp follows S-curves accurately
      let currentPathIdx = -1;
      let nearestDist = Infinity;
      for (const p of match.stage.platforms) {
        if (p.pathIndex === undefined) continue;
        const d = Math.hypot(cx - (p.x + p.w * 0.5), (robot.y + robot.h - p.y) * 1.2);
        if (d < nearestDist) {
          nearestDist = d;
          currentPathIdx = p.pathIndex;
        }
      }

      let destPlat: Platform | undefined;
      if (currentPathIdx >= 0) {
        const pathAhead = match.stage.platforms
          .filter(
            (p) =>
              p.kind !== 'finish' &&
              p.kind !== 'crumbling' &&
              (p.pathIndex ?? -1) > currentPathIdx
          )
          .sort((a, b) => (a.pathIndex ?? 0) - (b.pathIndex ?? 0));
        destPlat =
          pathAhead.find((p) => (p.pathIndex ?? 0) >= currentPathIdx + 2 && (p.pathIndex ?? 0) <= currentPathIdx + 4) ??
          pathAhead[0];
      }

      if (!destPlat) {
        const dirToFinish = match.stage.finishX < robot.x ? -1 : 1;
        const aheadPlatforms = match.stage.platforms
          .filter(
            (p) =>
              p.kind !== 'finish' &&
              p.kind !== 'crumbling' &&
              (dirToFinish === 1
                ? p.x > robot.x + 120 && p.x < match.stage.finishX - 60
                : p.x < robot.x - 120 && p.x > match.stage.finishX + 60)
          )
          .sort((a, b) => (a.x - b.x) * dirToFinish);

        destPlat =
          aheadPlatforms.find((p) => {
            const dx = (p.x - robot.x) * dirToFinish;
            return dx >= 170 && dx <= 480;
          }) ?? aheadPlatforms[0];
      }

      if (destPlat) {
        robot.x = getSafePlatformSpawnX(destPlat, match.stage);
        robot.y = destPlat.y - robot.h - 18;
        robot.lastSafeY = destPlat.y - robot.h;
        const nextDir = destPlat.nextDir ?? (match.stage.finishX < robot.x ? -1 : 1);
        robot.facing = nextDir;
        robot.vx = nextDir * 180;
        robot.vy = -120;
        if (
          destPlat.kind === 'checkpoint' &&
          Math.hypot(
            getSafePlatformSpawnX(destPlat, match.stage) - robot.checkpointX,
            destPlat.baseY - robot.h - robot.checkpointY
          ) > 36
        ) {
          robot.checkpointX = getSafePlatformSpawnX(destPlat, match.stage);
          robot.checkpointY = destPlat.baseY - robot.h;
        }
      } else {
        const dirToFinish = match.stage.finishX < robot.x ? -1 : 1;
        robot.x += dirToFinish * 180;
        robot.facing = dirToFinish;
        robot.y -= 70;
        robot.vy = -160;
      }
      robot.onGround = false;
      robot.invulnTimer = Math.max(robot.invulnTimer, 0.9);
      emitEvent(match, {
        type: 'warp',
        x: robot.x + robot.w * 0.5,
        y: robot.y + robot.h * 0.5,
        actorId: robot.id,
        actorName: robot.name,
        colorIndex: robot.colorIndex,
      });
      break;
    }
    case 'jetpack': {
      robot.jetpackTimer = 3.8;
      robot.vy = Math.min(robot.vy, -460);
      robot.vx = robot.facing * Math.max(Math.abs(robot.vx), BASE_RUN_SPEED * 1.28);
      robot.onGround = false;
      robot.coyoteTimer = 0;
      robot.carryingPlatformId = null;
      robot.dashCooldown = 0;
      robot.scaleX = 0.85;
      robot.scaleY = 1.22;
      emitEvent(match, {
        type: 'jetpack',
        x: cx,
        y: cy,
        actorId: robot.id,
        actorName: robot.name,
        colorIndex: robot.colorIndex,
      });
      break;
    }
  }
}

export function computeBotInput(
  bot: RobotState,
  stage: StageData,
  simTime: number,
  botIndex: number
): PlayerInput {
  if (bot.finished) {
    return {
      left: false,
      right: false,
      down: false,
      jump: false,
      jumpJustPressed: false,
      dashJustPressed: false,
      useItem: false,
    };
  }

  const cx = bot.x + bot.w * 0.5;
  const bottom = bot.y + bot.h;

  // Human personality traits derived from botIndex:
  // 0: Speedrunner/Aggressive, 1: Cautious/Technical, 2: Collector/Creative, 3: Balanced/Competitor
  const archetype = ((botIndex % 4) + 4) % 4;
  const rhythmWave = Math.sin(simTime * (1.6 + archetype * 0.35) + botIndex * 2.1);
  const cautionOffset = archetype === 1 ? 8 : archetype === 0 ? -4 : 3;
  const likesPickups = archetype === 2 || archetype === 0 || rhythmWave > 0.15;

  // 1. Identify platform currently under the bot when grounded
  const standingPlat = bot.onGround
    ? stage.platforms.find(
        (p) =>
          p.crumbleState !== 'fallen' &&
          cx >= p.x - 12 &&
          cx <= p.x + p.w + 12 &&
          Math.abs(bottom - p.y) <= 18
      )
    : undefined;

  // 2. When airborne, lock onto the exact platform the bot took off from using bot.lastSafeY
  // so the bot never loses track of its S-curve direction or bounce-pad climb mid-flight!
  const lastStandingPlatY = bot.lastSafeY + bot.h;
  let departureOrCurrentPlat: Platform | undefined = standingPlat;
  if (!departureOrCurrentPlat) {
    let bestScore = Infinity;
    for (const p of stage.platforms) {
      if (p.crumbleState === 'fallen') continue;
      // Prefer integer main-path platforms over fractional bonus ledges as reference
      const isBonus = p.pathIndex !== undefined && !Number.isInteger(p.pathIndex);
      const dyFromSafe = Math.abs(p.baseY - lastStandingPlatY);
      const horizDist =
        cx < p.x ? p.x - cx : cx > p.x + p.w ? cx - (p.x + p.w) : 0;
      if (dyFromSafe <= 56 && horizDist <= 340) {
        const score = dyFromSafe * 2.5 + horizDist + (isBonus ? 120 : 0);
        if (score < bestScore) {
          bestScore = score;
          departureOrCurrentPlat = p;
        }
      }
    }
    // Fallback if no platform matched lastSafeY (e.g. initial spawn drop)
    if (!departureOrCurrentPlat) {
      for (const p of stage.platforms) {
        if (p.crumbleState === 'fallen') continue;
        const horizDist =
          cx < p.x ? p.x - cx : cx > p.x + p.w ? cx - (p.x + p.w) : 0;
        const vertDist = Math.abs(bottom - p.y);
        const score = horizDist + vertDist * 1.4;
        if (score < bestScore) {
          bestScore = score;
          departureOrCurrentPlat = p;
        }
      }
    }
  }

  const refPlat = standingPlat ?? departureOrCurrentPlat;
  const nearbyPad = refPlat
    ? stage.bouncePads.find(
        (pad) =>
          pad.x + pad.w > refPlat.x &&
          pad.x < refPlat.x + refPlat.w &&
          Math.abs(pad.y + pad.h - refPlat.y) <= 14
      )
    : undefined;

  const refRightX = refPlat ? refPlat.x + refPlat.w : cx;
  const refLeftX = refPlat ? refPlat.x : cx;
  const refY = refPlat ? refPlat.y : bottom;
  const curPathIdx = refPlat?.pathIndex;

  let targetPlat: Platform | undefined;

  // 3. Select the next target platform along the stage path
  if (refPlat?.kind === 'finish') {
    targetPlat = refPlat;
  } else if (curPathIdx !== undefined) {
    const baseIdx = Math.floor(curPathIdx);
    // Primary next main-path platform (integer pathIndex = baseIdx + 1)
    const nextMainPlat = stage.platforms.find(
      (p) =>
        p.crumbleState !== 'fallen' &&
        p.id !== refPlat?.id &&
        p.pathIndex !== undefined &&
        Math.abs(p.pathIndex - (baseIdx + 1)) < 0.05
    );

    // If airborne and already high above & over baseIdx + 2 (e.g. from BoostRing / Whirlwind), allow landing on baseIdx + 2
    const skipAheadPlat = !bot.onGround
      ? stage.platforms.find(
          (p) =>
            p.crumbleState !== 'fallen' &&
            p.pathIndex !== undefined &&
            Math.abs(p.pathIndex - (baseIdx + 2)) < 0.05 &&
            bottom <= p.y + 12 &&
            cx >= p.x - 28 &&
            cx <= p.x + p.w + 28
        )
      : undefined;

    // Optional upper bonus platform (fractional pathIndex = baseIdx + 0.4) for collector/speedrunner bots
    const bonusCandidate =
      likesPickups && curPathIdx === baseIdx
        ? stage.platforms.find(
            (p) =>
              p.crumbleState !== 'fallen' &&
              p.pathIndex !== undefined &&
              Math.abs(p.pathIndex - (baseIdx + 0.4)) < 0.1 &&
              refY - p.y <= 88 &&
              Math.abs((p.x + p.w * 0.5) - cx) <= 135
          )
        : undefined;

    if (skipAheadPlat) {
      targetPlat = skipAheadPlat;
    } else if (bonusCandidate && !nearbyPad) {
      targetPlat = bonusCandidate;
    } else if (nextMainPlat) {
      targetPlat = nextMainPlat;
    } else {
      // Fallback search for any reachable platform with higher pathIndex
      const pathCandidates = stage.platforms
        .filter((p) => {
          if (p.crumbleState === 'fallen' || p.id === refPlat?.id) return false;
          if (p.pathIndex === undefined || p.pathIndex <= curPathIdx) return false;
          return p.pathIndex <= baseIdx + 3;
        })
        .sort((a, b) => (a.pathIndex ?? 999) - (b.pathIndex ?? 999) || b.w - a.w);
      targetPlat = pathCandidates[0];
    }
  }

  // Fallback for custom test stages without pathIndex metadata
  if (!targetPlat) {
    const fallbackDir = refPlat?.nextDir ?? 1;
    const candidates = stage.platforms
      .filter((p) => {
        if (p.crumbleState === 'fallen') return false;
        if (standingPlat && p.id === standingPlat.id) return false;
        if (refPlat && p.id === refPlat.id) return false;

        const advances =
          fallbackDir === 1
            ? p.x + p.w * 0.55 > refRightX + 8
            : p.x + p.w * 0.45 < refLeftX - 8;
        if (!advances) return false;

        const horizGap =
          fallbackDir === 1
            ? Math.max(0, p.x - refRightX)
            : Math.max(0, refLeftX - (p.x + p.w));
        const stepUp = refY - p.y;
        const maxJumpStep = nearbyPad ? 225 : 122;
        return horizGap <= 320 && stepUp <= maxJumpStep && stepUp >= -2400;
      })
      .sort((a, b) => {
        const bonusPenaltyA = a.w < 110 ? 90 : 0;
        const bonusPenaltyB = b.w < 110 ? 90 : 0;
        const gapA =
          fallbackDir === 1
            ? Math.max(0, a.x - refRightX)
            : Math.max(0, refLeftX - (a.x + a.w));
        const gapB =
          fallbackDir === 1
            ? Math.max(0, b.x - refRightX)
            : Math.max(0, refLeftX - (b.x + b.w));
        const climbRewardA = Math.max(0, refY - a.y) * 0.35;
        const climbRewardB = Math.max(0, refY - b.y) * 0.35;
        return gapA + bonusPenaltyA - climbRewardA - (gapB + bonusPenaltyB - climbRewardB);
      });

    targetPlat = candidates[0];
  }

  // Determine intended horizontal direction (+1 right or -1 left on S-curve switchbacks)
  const finishCenterX = stage.finishX + stage.finishW * 0.5;
  const intendedDir: -1 | 1 =
    standingPlat?.kind === 'finish'
      ? cx > finishCenterX + 8
        ? -1
        : 1
      : targetPlat && refPlat && targetPlat.id !== refPlat.id
      ? targetPlat.x + targetPlat.w * 0.5 < refPlat.x + refPlat.w * 0.5
        ? -1
        : 1
      : refPlat?.nextDir ?? 1;

  let moveDir: -1 | 0 | 1 = intendedDir;
  let wantJump = false;
  let wantDash = false;
  let wantDown = false;

  if (standingPlat) {
    // If standing on the Finish platform, run straight into the Finish Portal!
    if (standingPlat.kind === 'finish') {
      moveDir = cx > finishCenterX + 6 ? -1 : cx < finishCenterX - 6 ? 1 : intendedDir;
      if (Math.abs(cx - finishCenterX) <= 42 && bottom > stage.finishY + stage.finishH) {
        wantJump = true;
      }
    } else {
      const distToTakeoffEdge =
        intendedDir === 1
          ? standingPlat.x + standingPlat.w - cx
          : cx - standingPlat.x;

      const onOpposingConveyor =
        standingPlat.kind === 'conveyor' &&
        ((intendedDir === 1 && (standingPlat.conveyorSpeed ?? 0) < 0) ||
          (intendedDir === -1 && (standingPlat.conveyorSpeed ?? 0) > 0));

      const isShakingCrumble =
        standingPlat.kind === 'crumbling' && standingPlat.crumbleState === 'shaking';

      const laserAhead = stage.hazards.find(
        (h) =>
          h.kind === 'laser' &&
          (intendedDir === 1
            ? h.x > cx - 6 && h.x < cx + 68 + cautionOffset
            : h.x + h.w < cx + 6 && h.x + h.w > cx - (68 + cautionOffset)) &&
          Math.abs(h.y + h.h - standingPlat.y) <= 20 &&
          isLaserActive(h.cyclePeriod, h.cycleOffset, simTime + 0.16)
      );

      const sawOrDroneAhead = stage.hazards.find(
        (h) =>
          (h.kind === 'saw' || h.kind === 'drone') &&
          (intendedDir === 1
            ? h.x + h.w > cx - 6 && h.x < cx + 74 + cautionOffset
            : h.x < cx + 6 && h.x + h.w > cx - (74 + cautionOffset)) &&
          Math.abs(h.y + h.h - standingPlat.y) <= 76
      );

      // Human-like Opportunistic Item Box / Crystal pickup on the current platform
      let chasingPickup = false;
      if (!bot.heldItem && likesPickups && !isShakingCrumble && !laserAhead && !sawOrDroneAhead) {
        const boxOnPlat = stage.itemBoxes.find(
          (b) =>
            b.respawnAt === 0 &&
            b.x + 15 >= standingPlat.x + 12 &&
            b.x + 15 <= standingPlat.x + standingPlat.w - 12 &&
            standingPlat.y - b.y >= 16 &&
            standingPlat.y - b.y <= 78 &&
            ((intendedDir === 1 && b.x + 15 >= cx - 32) ||
              (intendedDir === -1 && b.x + 15 <= cx + 32))
        );
        if (boxOnPlat) {
          const boxCenterX = boxOnPlat.x + 15;
          chasingPickup = true;
          moveDir = boxCenterX < cx - 6 ? -1 : boxCenterX > cx + 6 ? 1 : intendedDir;
          if (Math.abs(boxCenterX - cx) <= 34 && standingPlat.y - boxOnPlat.y > 42) {
            wantJump = true;
          }
        }
      }

      // If there is a spring pad on this platform and the next platform is high up, walk onto the pad!
      const targetIsHigh = Boolean(targetPlat && standingPlat.y - targetPlat.y > 90);
      if (nearbyPad && targetIsHigh) {
        const padCenter = nearbyPad.x + nearbyPad.w * 0.5;
        moveDir = cx > padCenter + 5 ? -1 : cx < padCenter - 5 ? 1 : intendedDir;
        wantJump = false;
        // If somehow standing right on the pad center without bouncing yet, hop to trigger overlap
        if (Math.abs(cx - padCenter) <= 10 && Math.abs(bot.vx) < 15) {
          wantJump = true;
        }
      } else if (!chasingPickup && targetPlat) {
        moveDir = intendedDir;
        const stepUp = standingPlat.y - targetPlat.y;
        const liveHorizGap =
          intendedDir === 1
            ? Math.max(0, targetPlat.x - (standingPlat.x + standingPlat.w))
            : Math.max(0, standingPlat.x - (targetPlat.x + targetPlat.w));

        // Human patience for moving platforms: if targetPlat is currently swung too far out, wait near edge!
        const movingTooFarRightNow =
          !isShakingCrumble &&
          !onOpposingConveyor &&
          targetPlat.kind === 'moving' &&
          (liveHorizGap > 182 || (stepUp > 106 && !nearbyPad));

        const humanMarginWave = Math.round(rhythmWave * 6) + cautionOffset;
        const baseMargin = onOpposingConveyor
          ? 52
          : stepUp > 45 && liveHorizGap < 88
          ? 58
          : 38;
        const takeoffMargin = clamp(baseMargin + humanMarginWave, 28, 66);

        if (movingTooFarRightNow && distToTakeoffEdge <= 48) {
          moveDir = distToTakeoffEdge < 22 ? (-intendedDir as -1 | 1) : 0;
          wantJump = false;
        } else if (distToTakeoffEdge <= takeoffMargin) {
          wantJump = true;
        }

        // Human speedrunner dash on wide clear platforms
        if (
          !wantJump &&
          !laserAhead &&
          !sawOrDroneAhead &&
          bot.dashCooldown <= 0 &&
          standingPlat.w >= 195 &&
          distToTakeoffEdge > 110 &&
          (archetype === 0 || rhythmWave > 0.72)
        ) {
          wantDash = true;
        }
      } else if (!chasingPickup && distToTakeoffEdge <= 36) {
        wantJump = true;
      }

      // Apply hazard reactions last so safety overrides normal walking
      if (laserAhead && distToTakeoffEdge > 56 && !onOpposingConveyor && !isShakingCrumble) {
        moveDir = 0;
        wantJump = false;
        wantDash = false;
      } else if (sawOrDroneAhead) {
        wantJump = true;
      }

      if (onOpposingConveyor && bot.dashCooldown <= 0 && distToTakeoffEdge > 42) {
        wantDash = true;
      }

      // Anti-stall unstick pulse: if grounded and barely moving when not waiting for a laser, hop forward
      if (
        !laserAhead &&
        Math.abs(bot.vx) < 18 &&
        Math.floor(simTime * 3 + botIndex) % 5 === 0
      ) {
        moveDir = intendedDir;
        wantJump = true;
      }
    }
  } else {
    // 4. Airborne human-like trajectory control (smooth, no left-right facing flicker!)
    if (targetPlat) {
      // Mid-air ledge miss recovery: if we fell below targetPlat.y + 24 while descending,
      // steer back toward departureOrCurrentPlat (or any platform below us) instead of falling into the abyss!
      const missedTargetLedge =
        bottom > targetPlat.y + 24 &&
        bot.vy > 70 &&
        refPlat &&
        refPlat.id !== targetPlat.id &&
        bottom <= refPlat.y + 18;

      const landPlat = missedTargetLedge ? refPlat : targetPlat;
      const safeMargin = Math.min(26, landPlat.w * 0.22);
      const targetLeft = landPlat.x + safeMargin;
      const targetRight = landPlat.x + landPlat.w - safeMargin;
      const predX = cx + bot.vx * 0.13;

      // Check if a pinball bumper is directly beneath the bot above landPlat so it doesn't pogo forever
      const bumperBelow = stage.bumpers.find(
        (b) =>
          Math.abs(b.x - cx) <= b.r + 24 &&
          b.y >= bottom - 14 &&
          b.y <= landPlat.y + 10
      );

      if (bumperBelow) {
        moveDir = intendedDir;
      } else if (cx < landPlat.x + 12) {
        moveDir = 1;
      } else if (cx > landPlat.x + landPlat.w - 12) {
        moveDir = -1;
      } else if (predX < targetLeft) {
        moveDir = 1;
      } else if (predX > targetRight) {
        moveDir = -1;
      } else {
        // Already over the safe interior of landPlat: keep smooth momentum or coast without flickering facing!
        moveDir = Math.abs(bot.vx) > 175 ? 0 : intendedDir;
      }

      // Hold jump while rising unless we are already comfortably above and over targetPlat
      const overTargetHoriz = cx >= landPlat.x + 14 && cx <= landPlat.x + landPlat.w - 14;
      const heightClearance = landPlat.y - bottom;
      if ((bot.jetpackTimer ?? 0) > 0) {
        // With active Jetpack, fire thrusters whenever below targetPlat or crossing the gap!
        if (!overTargetHoriz || heightClearance < 18) {
          wantJump = true;
        }
      } else if (bot.vy < -45 && !(overTargetHoriz && heightClearance > 36)) {
        wantJump = true;
      }

      // Human fast-fall (down = true) when floating high over the safe landing zone (e.g. WindZone or Whirlwind)
      if (
        overTargetHoriz &&
        heightClearance > 44 &&
        bot.vy > -90 &&
        (archetype !== 2 || heightClearance > 75)
      ) {
        wantDown = true;
      }

      // Use Air-Dash when genuinely falling short of the target ledge
      if (bot.dashCooldown <= 0 && bot.vy > 65 && !missedTargetLedge) {
        if (
          intendedDir === 1 &&
          cx < targetPlat.x + 6 &&
          targetPlat.x - cx > 22 &&
          targetPlat.x - cx < 145
        ) {
          moveDir = 1;
          wantDash = true;
        } else if (
          intendedDir === -1 &&
          cx > targetPlat.x + targetPlat.w - 6 &&
          cx - (targetPlat.x + targetPlat.w) > 22 &&
          cx - (targetPlat.x + targetPlat.w) < 145
        ) {
          moveDir = -1;
          wantDash = true;
        }
      }
    } else {
      moveDir = intendedDir;
      if (bot.vy < -45 || (bot.jetpackTimer ?? 0) > 0) {
        wantJump = true;
      }
    }
  }

  // Human reaction to Glitch (control inversion): brief 0.25s confusion, then adapts!
  if (bot.glitchTimer > 0 && moveDir !== 0) {
    const stillConfused = bot.glitchTimer > 2.15 && archetype !== 1;
    if (!stillConfused) {
      moveDir = (moveDir * -1) as -1 | 1;
    }
  }

  // 5. Contextual, human-like item usage
  let useItem = false;
  const itemPulse = (Math.floor(simTime * 6 + botIndex * 2.3) % 5) === 0;
  if (bot.heldItem !== null && itemPulse && bot.stunTimer <= 0) {
    switch (bot.heldItem) {
      case 'shield':
        useItem = bot.shieldTimer <= 0.2;
        break;
      case 'whirlwind':
        // Use whirlwind when grounded and climbing to a higher platform (or on straight stretches)
        useItem =
          bot.onGround &&
          Boolean(
            standingPlat &&
              targetPlat &&
              standingPlat.y - targetPlat.y >= 12 &&
              standingPlat.kind !== 'finish'
          );
        break;
      case 'barrier':
      case 'grease':
      case 'frost':
        // Drop traps while grounded on a platform
        useItem = bot.onGround && Math.abs(bot.vx) > 60;
        break;
      case 'turbo':
      case 'jetpack':
      case 'magnet':
      case 'warp':
        useItem = moveDir === intendedDir && bot.facing === intendedDir;
        break;
      default:
        useItem = true;
        break;
    }
  }

  return {
    left: moveDir === -1,
    right: moveDir === 1,
    down: wantDown,
    jump: wantJump,
    jumpJustPressed: wantJump && !bot.prevJumpHeld,
    dashJustPressed: wantDash,
    useItem,
  };
}

export function stepSimulation(
  match: MatchState,
  inputsByPlayerId: Map<string, PlayerInput>,
  dt: number,
  rngRoll: () => number = Math.random
): void {
  match.events = [];

  if (match.phase === 'lobby' || match.phase === 'editor_build') {
    return;
  }

  if (match.phase === 'map_preview') {
    match.raceTime += dt;
    updateStageDynamics(match.stage, match.raceTime);
    match.countdownTimer -= dt;
    if (match.countdownTimer <= 0) {
      match.raceTime = 0;
      updateStageDynamics(match.stage, 0);
      match.countdownTimer = 1.8;
      match.phase = 'countdown';
    }
    return;
  }

  if (match.phase === 'countdown') {
    match.countdownTimer -= dt;
    if (match.countdownTimer <= 0) {
      match.countdownTimer = 0;
      match.phase = 'racing';
    }
    return;
  }

  if (match.phase === 'podium') {
    match.podiumAutoTimer = Math.max(0, match.podiumAutoTimer - dt);
    return;
  }

  match.raceTime += dt;
  const platformDeltas = updateStageDynamics(match.stage, match.raceTime);

  // Update crumbling platform states
  for (const plat of match.stage.platforms) {
    if (plat.kind !== 'crumbling') continue;
    if (plat.crumbleState === 'shaking') {
      plat.crumbleTimer = (plat.crumbleTimer ?? 0) - dt;
      if ((plat.crumbleTimer ?? 0) <= 0) {
        plat.crumbleState = 'fallen';
        plat.crumbleTimer = 2.8;
      }
    } else if (plat.crumbleState === 'fallen') {
      plat.crumbleTimer = (plat.crumbleTimer ?? 0) - dt;
      if ((plat.crumbleTimer ?? 0) <= 0) {
        plat.crumbleState = 'intact';
        plat.crumbleTimer = 0;
      }
    }
  }

  for (const box of match.stage.itemBoxes) {
    if (box.respawnAt > 0 && match.raceTime >= box.respawnAt) {
      box.respawnAt = 0;
    }
  }

  for (const crystal of match.stage.crystals) {
    if (crystal.respawnAt > 0 && match.raceTime >= crystal.respawnAt) {
      crystal.respawnAt = 0;
    }
  }

  for (let i = 0; i < match.robots.length; i++) {
    const robot = match.robots[i];
    const cls = ROBOT_CLASSES[robot.robotClass] ?? ROBOT_CLASSES.balanced;

    robot.turboTimer = Math.max(0, robot.turboTimer - dt);
    robot.jetpackTimer = Math.max(0, (robot.jetpackTimer ?? 0) - dt);
    robot.shieldTimer = Math.max(0, robot.shieldTimer - dt);
    robot.empSlowTimer = Math.max(0, robot.empSlowTimer - dt);
    robot.frostTimer = Math.max(0, robot.frostTimer - dt);
    robot.greaseTimer = Math.max(0, (robot.greaseTimer ?? 0) - dt);
    robot.glitchTimer = Math.max(0, robot.glitchTimer - dt);
    robot.stunTimer = Math.max(0, robot.stunTimer - dt);
    robot.invulnTimer = Math.max(0, robot.invulnTimer - dt);
    robot.dashCooldown = Math.max(0, robot.dashCooldown - dt);
    const wasDashing = robot.dashTimer > 0;
    robot.dashTimer = Math.max(0, robot.dashTimer - dt);

    const relax = Math.min(1, dt * 14);
    robot.scaleX += (1 - robot.scaleX) * relax;
    robot.scaleY += (1 - robot.scaleY) * relax;

    if (robot.finished) {
      robot.vx *= Math.max(0, 1 - dt * 8);
      continue;
    }

    const input: PlayerInput = robot.isBot
      ? computeBotInput(robot, match.stage, match.raceTime, i)
      : inputsByPlayerId.get(robot.id) ?? {
          left: false,
          right: false,
          jump: false,
          jumpJustPressed: false,
          dashJustPressed: false,
          useItem: false,
        };

    if (robot.onGround && robot.carryingPlatformId !== null) {
      const delta = platformDeltas.get(robot.carryingPlatformId);
      if (delta) {
        robot.x += delta.dx;
        robot.y += delta.dy;
      }
      // Conveyor push
      const carriedPlat = match.stage.platforms.find((p) => p.id === robot.carryingPlatformId);
      if (carriedPlat && carriedPlat.kind === 'conveyor' && carriedPlat.conveyorSpeed) {
        robot.x += carriedPlat.conveyorSpeed * dt;
      }
    }

    // Item activation
    if (input.useItem && robot.heldItem && robot.stunTimer <= 0) {
      activateRobotItem(match, robot);
    }

    // Dash activation
    if (
      input.dashJustPressed &&
      robot.dashCooldown <= 0 &&
      robot.dashTimer <= 0 &&
      robot.stunTimer <= 0
    ) {
      const rawDir = (input.right ? 1 : 0) - (input.left ? 1 : 0);
      const dashDir = rawDir !== 0 ? (robot.glitchTimer > 0 ? -rawDir : rawDir) : robot.facing;
      robot.facing = dashDir > 0 ? 1 : -1;
      robot.dashTimer = DASH_DURATION;
      robot.dashCooldown = robot.dashMaxCooldown;
      robot.vx = robot.facing * DASH_SPEED * cls.speedMult;
      robot.vy = -35; // Controlled lift to cross gaps cleanly without overshooting
      robot.scaleX = 1.26;
      robot.scaleY = 0.78;
      emitEvent(match, {
        type: 'dash',
        x: robot.x + robot.w * 0.5,
        y: robot.y + robot.h * 0.5,
        actorId: robot.id,
        colorIndex: robot.colorIndex,
      });
    }

    // Slipstream / Vácuo de Perseguição: slight speed boost when closely drafting behind a rival
    const inSlipstream = match.robots.some(
      (rival) =>
        rival.id !== robot.id &&
        !rival.finished &&
        (rival.x - robot.x) * robot.facing >= 35 &&
        (rival.x - robot.x) * robot.facing <= 185 &&
        Math.abs(rival.y - robot.y) <= 72
    );

    // Precision Movement & Counter-Strafing (with human-like pacing and full mid-air jump envelope)
    const settings = match.matchSettings;
    const globalSpeedMult = settings?.speedMultiplier ?? 1.0;
    const globalGravityMult = settings?.gravityMultiplier ?? 1.0;
    const botDiffMult =
      settings?.botDifficulty === 'casual'
        ? 0.85
        : settings?.botDifficulty === 'pro'
        ? 1.12
        : 1.0;
    const baseBotPace =
      (0.95 + (i % 4) * 0.018 + Math.sin(match.raceTime * 1.15 + i * 1.9) * 0.022) *
      botDiffMult;
    const botPace = robot.isBot
      ? robot.onGround
        ? baseBotPace
        : Math.max(0.99 * Math.min(1, botDiffMult), baseBotPace)
      : 1.0;
    let speedMult =
      cls.speedMult *
      globalSpeedMult *
      botPace *
      (1 + Math.min(0.12, (robot.crystals ?? 0) * 0.015)) *
      (inSlipstream ? 1.07 : 1.0);
    if (robot.turboTimer > 0) speedMult *= 1.5;
    if (robot.jetpackTimer > 0) speedMult *= 1.35;
    if (robot.empSlowTimer > 0) speedMult *= 0.55;
    if (robot.frostTimer > 0) speedMult *= 0.45;
    if (robot.greaseTimer > 0) speedMult *= 0.65;
    if (robot.stunTimer > 0) speedMult *= 0.15;

    const maxSpeed = BASE_RUN_SPEED * speedMult;
    let rawMoveAxis = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    if (robot.glitchTimer > 0) {
      rawMoveAxis = -rawMoveAxis;
    }
    const moveAxis = robot.stunTimer > 0 ? 0 : rawMoveAxis;

    // Clamp excessive dash velocity immediately when dash ends for pinpoint landing control
    if (wasDashing && robot.dashTimer <= 0) {
      robot.vx = clamp(robot.vx, -maxSpeed * 1.06, maxSpeed * 1.06);
    }

    if (robot.dashTimer > 0) {
      robot.vx = robot.facing * DASH_SPEED * cls.speedMult * globalSpeedMult;
    } else if (moveAxis !== 0) {
      robot.facing = moveAxis > 0 ? 1 : -1;
      const baseAccel = robot.onGround ? GROUND_ACCEL : AIR_ACCEL;
      // Grease reduces traction when trying to turn around; otherwise 2.6x turn-around multiplier
      const isReversing = moveAxis * robot.vx < 0;
      const turnMult = robot.greaseTimer > 0 ? 0.32 : isReversing ? 2.6 : 1.0;
      const jetMult = robot.jetpackTimer > 0 ? 1.45 : 1.0;
      const accel =
        baseAccel *
        globalSpeedMult *
        turnMult *
        jetMult *
        (robot.turboTimer > 0 ? 1.3 : 1.0);
      robot.vx += moveAxis * accel * dt;
      if (Math.abs(robot.vx) > maxSpeed && robot.stunTimer <= 0 && robot.greaseTimer <= 0) {
        robot.vx += (moveAxis * maxSpeed - robot.vx) * Math.min(1, dt * 16);
      }
    } else {
      const decel =
        robot.greaseTimer > 0
          ? GROUND_DECEL * 0.08
          : robot.frostTimer > 0
          ? AIR_DECEL * 0.55
          : robot.onGround
          ? GROUND_DECEL
          : AIR_DECEL;
      if (Math.abs(robot.vx) <= decel * dt) {
        robot.vx = 0;
      } else {
        robot.vx -= Math.sign(robot.vx) * decel * dt;
      }
    }

    if (robot.onGround) {
      robot.coyoteTimer = COYOTE_TIME;
    } else {
      robot.coyoteTimer = Math.max(0, robot.coyoteTimer - dt);
    }

    if (input.jumpJustPressed) {
      robot.jumpBufferTimer = JUMP_BUFFER_TIME;
    } else {
      robot.jumpBufferTimer = Math.max(0, robot.jumpBufferTimer - dt);
    }

    if (
      robot.jumpBufferTimer > 0 &&
      robot.coyoteTimer > 0 &&
      robot.stunTimer <= 0
    ) {
      const isDashJump = robot.dashTimer > 0 || wasDashing;
      const jumpPower =
        JUMP_VELOCITY *
        cls.jumpMult *
        (isDashJump ? 1.06 : 1.0) *
        (robot.turboTimer > 0 ? 1.1 : 1.0) *
        (robot.empSlowTimer > 0 ? 0.85 : 1.0) *
        (robot.greaseTimer > 0 ? 0.86 : 1.0);
      robot.vy = jumpPower;
      if (isDashJump) {
        robot.vx = robot.facing * Math.max(Math.abs(robot.vx), maxSpeed * 1.18);
      }
      robot.onGround = false;
      robot.coyoteTimer = 0;
      robot.jumpBufferTimer = 0;
      robot.carryingPlatformId = null;
      robot.dashTimer = 0;
      robot.scaleX = 0.84;
      robot.scaleY = 1.2;
      emitEvent(match, {
        type: 'jump',
        x: robot.x + robot.w * 0.5,
        y: robot.y + robot.h,
        actorId: robot.id,
        colorIndex: robot.colorIndex,
      });
    }

    if (
      !input.jump &&
      robot.prevJumpHeld &&
      robot.vy < -140 &&
      robot.dashTimer <= 0 &&
      robot.jetpackTimer <= 0
    ) {
      robot.vy *= JUMP_CUT_FACTOR;
    }
    robot.prevJumpHeld = input.jump;

    // Active Jetpack Thrust + Gravity (with Apex Hang-Time precision), Fast-Fall & Wind Updrafts
    if (robot.dashTimer <= 0) {
      if (robot.jetpackTimer > 0 && input.jump && !input.down && robot.stunTimer <= 0) {
        // Holding Jump while Jetpack is active fires dual plasma thrusters upward!
        robot.vy = Math.max(-450, robot.vy - 2450 * dt);
        robot.onGround = false;
        robot.carryingPlatformId = null;
      } else {
        const nearApex = !robot.onGround && input.jump && !input.down && Math.abs(robot.vy) < 110;
        const gravityMult =
          (input.down && !robot.onGround && robot.vy > -120
            ? 1.75
            : robot.jetpackTimer > 0
            ? 0.42
            : nearApex
            ? 0.6
            : 1.0) * globalGravityMult;
        const maxFall = input.down
          ? MAX_FALL_SPEED * 1.18
          : robot.jetpackTimer > 0
          ? 220
          : MAX_FALL_SPEED;
        robot.vy = Math.min(maxFall, robot.vy + GRAVITY * gravityMult * dt);
      }

      for (const wind of match.stage.windZones) {
        if (aabbOverlap(robot.x, robot.y, robot.w, robot.h, wind.x, wind.y, wind.w, wind.h)) {
          const windFactor = input.down ? 0.35 : 1.0;
          robot.vy = Math.max(-440, robot.vy + wind.forceY * windFactor * dt);
        }
      }
    }

    const prevBottom = robot.y + robot.h;
    const wasOnGround = robot.onGround;
    robot.x += robot.vx * dt;
    robot.y += robot.vy * dt;

    robot.onGround = false;
    robot.carryingPlatformId = null;

    if (robot.vy >= -65) {
      const newBottom = robot.y + robot.h;
      for (const plat of match.stage.platforms) {
        if (plat.kind === 'crumbling' && plat.crumbleState === 'fallen') {
          continue;
        }
        const delta = platformDeltas.get(plat.id);
        const prevPlatY = delta ? delta.prevY : plat.y;

        const horizOverlap =
          robot.x + robot.w - 2 > plat.x && robot.x + 2 < plat.x + plat.w;

        // Ledge forgiveness & Auto Ledge-Mantle: allow up to 24px top-lip vault when pressing toward platform
        const lipTolerance = robot.vy >= 0 ? (moveAxis !== 0 ? 24 : 18) : 12;
        if (
          horizOverlap &&
          prevBottom <= prevPlatY + lipTolerance &&
          newBottom >= plat.y - 2
        ) {
          robot.y = plat.y - robot.h;
          robot.vy = 0;
          robot.onGround = true;
          robot.carryingPlatformId = plat.id;
          robot.lastSafeY = plat.y - robot.h;

          if (plat.kind === 'crumbling' && plat.crumbleState === 'intact') {
            plat.crumbleState = 'shaking';
            plat.crumbleTimer = 0.65;
          }

          if (!wasOnGround) {
            robot.scaleX = 1.2;
            robot.scaleY = 0.8;
          }

          if (
            plat.kind === 'checkpoint' &&
            (plat.baseY < robot.checkpointY - 25 ||
              plat.baseX > robot.checkpointX + 20 ||
              (match.gameMode === 'editor' &&
                Math.hypot(
                  getSafePlatformSpawnX(plat, match.stage) - robot.checkpointX,
                  plat.baseY - robot.h - robot.checkpointY
                ) > 36))
          ) {
            robot.checkpointX = getSafePlatformSpawnX(plat, match.stage);
            robot.checkpointY = plat.baseY - robot.h;
            emitEvent(match, {
              type: 'checkpoint',
              x: plat.x + 24,
              y: plat.y - 30,
              actorId: robot.id,
              actorName: robot.name,
              colorIndex: robot.colorIndex,
            });
          }
          break;
        }
      }
    }

    // Also allow activating a checkpoint by passing through its beacon gate above the platform
    for (const plat of match.stage.platforms) {
      if (plat.kind !== 'checkpoint') continue;
      const isNewEditorCheckpoint =
        match.gameMode === 'editor' &&
        Math.hypot(
          getSafePlatformSpawnX(plat, match.stage) - robot.checkpointX,
          plat.baseY - robot.h - robot.checkpointY
        ) > 36;
      if (
        (plat.baseY < robot.checkpointY - 25 ||
          plat.baseX > robot.checkpointX + 20 ||
          isNewEditorCheckpoint) &&
        aabbOverlap(robot.x, robot.y, robot.w, robot.h, plat.x, plat.y - 54, plat.w, plat.h + 54)
      ) {
        robot.checkpointX = getSafePlatformSpawnX(plat, match.stage);
        robot.checkpointY = plat.baseY - robot.h;
        robot.lastSafeY = plat.baseY - robot.h;
        emitEvent(match, {
          type: 'checkpoint',
          x: plat.x + 24,
          y: plat.y - 30,
          actorId: robot.id,
          actorName: robot.name,
          colorIndex: robot.colorIndex,
        });
      }
    }

    if (robot.onGround && Math.abs(robot.vx) > 15) {
      robot.stridePhase += Math.abs(robot.vx) * dt * 0.08;
    }

    for (const pad of match.stage.bouncePads) {
      if (
        aabbOverlap(robot.x, robot.y, robot.w, robot.h, pad.x, pad.y, pad.w, pad.h) &&
        robot.vy >= -80
      ) {
        robot.vy = pad.power * (robot.turboTimer > 0 ? 1.1 : 1.0);
        robot.onGround = false;
        robot.coyoteTimer = 0;
        robot.carryingPlatformId = null;
        robot.lastSafeY = pad.y + pad.h - robot.h;
        robot.dashTimer = 0;
        robot.dashCooldown = Math.max(0, robot.dashCooldown - 0.9);
        robot.scaleX = 0.78;
        robot.scaleY = 1.28;
        emitEvent(match, {
          type: 'spring',
          x: pad.x + pad.w * 0.5,
          y: pad.y,
          actorId: robot.id,
          colorIndex: robot.colorIndex,
        });
      }
    }

    // Boost Rings (Anéis Propulsores)
    const rcx = robot.x + robot.w * 0.5;
    const rcy = robot.y + robot.h * 0.5;
    for (const ring of match.stage.boostRings) {
      const dist = Math.hypot(rcx - ring.x, rcy - ring.y);
      if (dist <= ring.r + 16 && (robot.vy > ring.boostVy + 40 || Math.abs(robot.vx) < Math.abs(ring.boostVx) * 0.92)) {
        const launchDir: 1 | -1 =
          ring.boostVx < 0
            ? -1
            : robot.vx < -15
            ? -1
            : robot.vx > 15
            ? 1
            : robot.facing;
        robot.facing = launchDir;
        robot.vx = launchDir * Math.max(Math.abs(robot.vx), Math.abs(ring.boostVx));
        robot.vy = Math.min(robot.vy, ring.boostVy);
        robot.onGround = false;
        robot.dashCooldown = 0;
        robot.turboTimer = Math.max(robot.turboTimer, 0.95);
        robot.scaleX = 1.28;
        robot.scaleY = 0.76;
        emitEvent(match, {
          type: 'boost_ring',
          x: ring.x,
          y: ring.y,
          actorId: robot.id,
          actorName: robot.name,
          colorIndex: robot.colorIndex,
        });
      }
    }

    // Electromagnetic Bumpers (Rebatedores)
    for (const bumper of match.stage.bumpers) {
      const dist = Math.hypot(rcx - bumper.x, rcy - bumper.y);
      if (dist <= bumper.r + 16) {
        const pushDir =
          Math.abs(rcx - bumper.x) <= 8
            ? robot.facing
            : rcx < bumper.x
            ? -1
            : 1;
        robot.vx = pushDir * Math.max(255, Math.abs(robot.vx));
        robot.vy = -530;
        robot.onGround = false;
        robot.coyoteTimer = 0;
        robot.lastSafeY = Math.min(robot.lastSafeY, bumper.y + 94 - robot.h);
        robot.dashCooldown = 0;
        robot.scaleX = 0.78;
        robot.scaleY = 1.25;
        emitEvent(match, {
          type: 'bumper',
          x: bumper.x,
          y: bumper.y,
          actorId: robot.id,
          actorName: robot.name,
          colorIndex: robot.colorIndex,
        });
      }
    }

    // Energy Crystals (Cristais de Energia)
    for (const crystal of match.stage.crystals) {
      if (crystal.respawnAt > 0) continue;
      if (Math.hypot(rcx - crystal.x, rcy - crystal.y) <= 22) {
        crystal.respawnAt = match.raceTime + 8.0;
        robot.crystals = (robot.crystals ?? 0) + 1;
        robot.score += 5;
        robot.dashCooldown = Math.max(0, robot.dashCooldown - 0.35);
        emitEvent(match, {
          type: 'crystal',
          x: crystal.x,
          y: crystal.y,
          actorId: robot.id,
          actorName: robot.name,
          colorIndex: robot.colorIndex,
        });
      }
    }

    const sortedNow = getSortedRacers(match.robots);
    const itemFreq = settings?.itemFrequency ?? 'normal';
    const boxRespawnDuration = itemFreq === 'frenzy' ? 2.5 : 6.5;
    if (itemFreq !== 'none') {
      for (const box of match.stage.itemBoxes) {
        if (box.respawnAt > 0) continue;
        if (aabbOverlap(robot.x, robot.y, robot.w, robot.h, box.x, box.y, 30, 30)) {
          box.respawnAt = match.raceTime + boxRespawnDuration;
          let granted: ItemType | undefined;
          if (!robot.heldItem) {
            // Grant the exact item displayed inside the box (or weighted fallback if missing)
            const isLeader = sortedNow.length >= 2 && sortedNow[0]?.id === robot.id;
            const visibleItem = box.itemType;
            const picked =
              visibleItem && !(isLeader && visibleItem === 'warp')
                ? visibleItem
                : pickWeightedItem(robot, sortedNow, rngRoll);
            robot.heldItem = picked;
            granted = picked;
          } else {
            robot.turboTimer = Math.max(robot.turboTimer, 0.9);
            robot.dashCooldown = Math.max(0, robot.dashCooldown - 0.6);
          }
          // Rotate the item inside the box for its next respawn
          box.itemType = pickWeightedItem(robot, sortedNow, rngRoll);
          emitEvent(match, {
            type: 'pickup',
            x: box.x + 15,
            y: box.y + 15,
            actorId: robot.id,
            actorName: robot.name,
            itemType: granted,
            colorIndex: robot.colorIndex,
          });
        }
      }
    }

    if (settings?.hazardsEnabled !== false) {
      for (const haz of match.stage.hazards) {
        if (
          haz.kind === 'laser' &&
          !isLaserActive(haz.cyclePeriod, haz.cycleOffset, match.raceTime)
        ) {
          continue;
        }

        // Stomping a patrol drone's top dome bounces the robot upward like a spring!
        if (
          haz.kind === 'drone' &&
          robot.vy >= -30 &&
          prevBottom <= haz.y + 14 &&
          aabbOverlap(robot.x, robot.y, robot.w, robot.h, haz.x - 2, haz.y - 4, haz.w + 4, 16)
        ) {
          robot.y = haz.y - robot.h - 2;
          robot.vy = -560;
          robot.onGround = false;
          robot.dashCooldown = 0;
          robot.scaleX = 0.8;
          robot.scaleY = 1.24;
          emitEvent(match, {
            type: 'spring',
            x: haz.x + haz.w * 0.5,
            y: haz.y,
            actorId: robot.id,
            colorIndex: robot.colorIndex,
          });
          continue;
        }

        const pad = 4;
        if (
          aabbOverlap(
            robot.x + 2,
            robot.y + 2,
            robot.w - 4,
            robot.h - 4,
            haz.x + pad,
            haz.y + pad,
            haz.w - pad * 2,
            haz.h - pad * 2
          )
        ) {
          const knockDir = robot.x + robot.w * 0.5 < haz.x + haz.w * 0.5 ? -1 : 1;
          absorbOrHurt(match, robot, knockDir * 145, -240, 0.26, 'hurt');
        }
      }
    }

    // Evaluate Finish Portal arrival BEFORE fall detection so diving into a lower portal always succeeds
    robot.progress = computeRobotProgress(robot, match.stage);
    if (
      aabbOverlap(
        robot.x,
        robot.y,
        robot.w,
        robot.h,
        match.stage.finishX,
        match.stage.finishY,
        match.stage.finishW,
        match.stage.finishH
      )
    ) {
      const finishedCount = match.robots.filter((r) => r.finished).length;
      robot.finished = true;
      robot.finishTime = Number(match.raceTime.toFixed(2));
      robot.finishRank = finishedCount + 1;
      robot.progress = 100;
      const totalRacers = match.robots.length;
      if (match.gameMode === 'editor') {
        if (finishedCount === 0) {
          robot.score += 100;
        } else if (finishedCount === totalRacers - 1 && totalRacers > 1) {
          robot.score += 0;
        } else {
          const ratio = (totalRacers - 1 - finishedCount) / Math.max(1, totalRacers - 1);
          robot.score += Math.round(ratio * 65);
        }
      } else {
        const rankPoints = Math.max(10, (totalRacers - finishedCount) * 25);
        robot.score += rankPoints;
      }
      emitEvent(match, {
        type: 'finish',
        x: match.stage.finishX + match.stage.finishW * 0.5,
        y: match.stage.finishY + match.stage.finishH * 0.5,
        actorId: robot.id,
        actorName: robot.name,
        colorIndex: robot.colorIndex,
      });
    }

    if (!robot.finished) {
      const fallLimitY = computeRobotFallLimitY(robot, match.stage, match.gameMode);
      if (robot.y > fallLimitY) {
        const cpPlat = match.stage.platforms.find(
          (p) =>
            Math.abs(p.baseY - (robot.checkpointY + robot.h)) <= 20 &&
            robot.checkpointX + robot.w * 0.5 >= p.baseX - 20 &&
            robot.checkpointX + robot.w * 0.5 <= p.baseX + p.w + 20
        );
        robot.x = robot.checkpointX;
        robot.y = robot.checkpointY - 10;
        robot.lastSafeY = robot.checkpointY;
        robot.facing = cpPlat?.nextDir ?? 1;
        robot.vx = 0;
        robot.vy = 0;
        robot.dashTimer = 0;
        robot.dashCooldown = 0;
        robot.turboTimer = Math.max(robot.turboTimer, 0.85);
        robot.onGround = false;
        robot.invulnTimer = 1.4;
        robot.stunTimer = 0.15;
        emitEvent(match, {
          type: 'fall_reset',
          x: robot.x + robot.w * 0.5,
          y: robot.y + robot.h * 0.5,
          actorId: robot.id,
          actorName: robot.name,
          colorIndex: robot.colorIndex,
        });
      }
    }
  }

  for (let i = match.projectiles.length - 1; i >= 0; i--) {
    const proj = match.projectiles[i];
    proj.ttl -= dt;
    if (proj.ttl <= 0) {
      match.projectiles.splice(i, 1);
      continue;
    }

    if (proj.targetId) {
      const target = match.robots.find((r) => r.id === proj.targetId && !r.finished);
      if (target) {
        const tx = target.x + target.w * 0.5;
        const ty = target.y + target.h * 0.5;
        const dx = tx - proj.x;
        const dy = ty - proj.y;
        const dist = Math.hypot(dx, dy) || 1;
        const desiredVx = (dx / dist) * 560;
        const desiredVy = (dy / dist) * 560;
        proj.vx += (desiredVx - proj.vx) * Math.min(1, dt * 5.5);
        proj.vy += (desiredVy - proj.vy) * Math.min(1, dt * 5.5);
      }
    }

    proj.x += proj.vx * dt;
    proj.y += proj.vy * dt;

    let hit = false;
    for (const robot of match.robots) {
      if (robot.id === proj.ownerId || robot.finished) continue;
      if (aabbOverlap(proj.x - 10, proj.y - 10, 20, 20, robot.x, robot.y, robot.w, robot.h)) {
        absorbOrHurt(match, robot, -180, -340, 1.15, 'rocket_hit');
        hit = true;
        break;
      }
    }
    if (hit) {
      match.projectiles.splice(i, 1);
    }
  }

  for (let i = match.traps.length - 1; i >= 0; i--) {
    const trap = match.traps[i];
    trap.ttl -= dt;
    if (trap.ttl <= 0) {
      match.traps.splice(i, 1);
      continue;
    }

    let triggered = false;
    for (const robot of match.robots) {
      if (robot.finished) continue;

      if (trap.kind === 'barrier') {
        if (robot.id === trap.ownerId) continue;
        const bw = trap.w ?? 22;
        const bh = trap.h ?? 72;
        if (aabbOverlap(trap.x, trap.y, bw, bh, robot.x, robot.y, robot.w, robot.h)) {
          const pushDir = robot.x + robot.w * 0.5 < trap.x + bw * 0.5 ? -1 : 1;
          absorbOrHurt(match, robot, pushDir * 290, -240, 0.45, 'barrier_hit');
          triggered = true;
          break;
        }
      } else if (trap.kind === 'grease_slick') {
        if (robot.id === trap.ownerId && trap.ttl > 14.8) continue;
        const gw = trap.w ?? 84;
        const gh = trap.h ?? 16;
        if (
          robot.greaseTimer <= 0.4 &&
          aabbOverlap(trap.x, trap.y - 8, gw, gh + 10, robot.x, robot.y, robot.w, robot.h)
        ) {
          if (robot.shieldTimer > 0) {
            robot.shieldTimer = 0;
            robot.invulnTimer = 1.0;
          } else {
            robot.greaseTimer = 2.6;
            robot.vx = (Math.abs(robot.vx) > 60 ? Math.sign(robot.vx) : robot.facing) * 395;
            robot.scaleX = 1.24;
            robot.scaleY = 0.78;
            emitEvent(match, {
              type: 'grease_hit',
              x: robot.x + robot.w * 0.5,
              y: robot.y + robot.h,
              actorId: robot.id,
              actorName: robot.name,
              colorIndex: robot.colorIndex,
            });
          }
          trap.ttl -= 5.5;
          if (trap.ttl <= 0) {
            triggered = true;
          }
          break;
        }
      } else if (trap.kind === 'whirlwind') {
        if (robot.id === trap.ownerId && trap.ttl > 12.8) continue;
        const ww = trap.w ?? 48;
        const wh = trap.h ?? 82;
        if (aabbOverlap(trap.x, trap.y, ww, wh, robot.x, robot.y, robot.w, robot.h)) {
          if (robot.shieldTimer > 0) {
            robot.shieldTimer = 0;
            robot.invulnTimer = 1.0;
          } else {
            // Throws the robot VERY HIGH into the air!
            robot.vy = -1120;
            robot.vx = (rngRoll() - 0.5) * 260;
            robot.onGround = false;
            robot.coyoteTimer = 0;
            robot.carryingPlatformId = null;
            robot.scaleX = 0.72;
            robot.scaleY = 1.34;
            emitEvent(match, {
              type: 'whirlwind_hit',
              x: robot.x + robot.w * 0.5,
              y: robot.y + robot.h * 0.5,
              actorId: robot.id,
              actorName: robot.name,
              colorIndex: robot.colorIndex,
            });
          }
          triggered = true;
          break;
        }
      } else {
        // 'frost_mine'
        if (robot.id === trap.ownerId && trap.ttl > 16.8) continue;
        if (
          aabbOverlap(
            trap.x,
            trap.y - 10,
            trap.radius * 1.5,
            24,
            robot.x,
            robot.y,
            robot.w,
            robot.h
          )
        ) {
          if (robot.shieldTimer > 0) {
            robot.shieldTimer = 0;
            robot.invulnTimer = 1.0;
          } else {
            robot.frostTimer = 2.2;
            emitEvent(match, {
              type: 'frost_hit',
              x: robot.x + robot.w * 0.5,
              y: robot.y + robot.h * 0.5,
              actorId: robot.id,
              actorName: robot.name,
              colorIndex: robot.colorIndex,
            });
          }
          triggered = true;
          break;
        }
      }
    }
    if (triggered) {
      match.traps.splice(i, 1);
    }
  }

  const finishedHumans = match.robots.filter((r) => !r.isBot && r.finished).length;
  const totalHumans = match.robots.filter((r) => !r.isBot).length;
  const allRobotsFinished = match.robots.every((r) => r.finished);
  const firstFinishTime = match.robots.reduce<number | null>((min, r) => {
    if (r.finishTime === null) return min;
    return min === null ? r.finishTime : Math.min(min, r.finishTime);
  }, null);

  const humansDone = totalHumans > 0 && finishedHumans === totalHumans;
  const raceTimeoutAfterWinner =
    firstFinishTime !== null && match.raceTime - firstFinishTime >= 24;
  const humansFinishedGrace =
    humansDone && firstFinishTime !== null && match.raceTime - firstFinishTime >= 1.5;
  const editorCourseTimeout =
    match.gameMode === 'editor' &&
    match.raceTime >= (match.editorState?.currentMapCourseLimit ?? 45);

  if (allRobotsFinished || humansFinishedGrace || raceTimeoutAfterWinner || editorCourseTimeout) {
    const remaining = match.robots
      .filter((r) => !r.finished)
      .sort((a, b) => b.progress - a.progress || b.x - a.x);
    let nextRank = match.robots.filter((r) => r.finished).length + 1;
    const totalRacers = match.robots.length;
    for (const r of remaining) {
      const rank = nextRank++;
      r.finishRank = rank;
      if (match.gameMode === 'editor') {
        if (rank === 1) {
          r.score += 100;
        } else if (rank < totalRacers) {
          const ratio = (totalRacers - rank) / Math.max(1, totalRacers - 1);
          r.score += Math.round(ratio * 45);
        }
      }
    }

    if (match.gameMode === 'editor' && match.editorState) {
      const ordered = [...match.robots].sort(
        (a, b) => (a.finishRank ?? 999) - (b.finishRank ?? 999)
      );
      const winner = ordered[0];
      const lastPlace = ordered[ordered.length - 1];
      const mapIndex = match.editorState.currentMapIndex;
      const alreadyRecorded = match.editorState.roundResults.some(
        (res) => res.mapIndex === mapIndex
      );
      if (!alreadyRecorded && winner && lastPlace) {
        match.editorState.roundResults.push({
          mapIndex,
          creatorId: match.editorState.currentMapCreatorId ?? '',
          creatorName: match.editorState.currentMapCreatorName ?? 'Criador',
          mapTitle: match.editorState.currentMapTitle ?? `Mapa #${mapIndex + 1}`,
          winnerId: winner.id,
          winnerName: winner.name,
          lastPlaceId: lastPlace.id,
          lastPlaceName: lastPlace.name,
        });
      }
      match.editorState.isTournamentFinal =
        match.editorState.currentMapIndex >= match.editorState.totalMaps - 1;
    }

    match.phase = 'podium';
    match.podiumAutoTimer = 12;
  }
}

export function createRobotState(params: {
  id: string;
  name: string;
  colorIndex: number;
  robotClass?: RobotClassId;
  isBot: boolean;
  stage: StageData;
  spawnSlot: number;
  score?: number;
}): RobotState {
  const offsetX = (params.spawnSlot % 5) * 34;
  const offsetY = Math.floor(params.spawnSlot / 5) * -4;
  const x = params.stage.startX + offsetX - 30;
  const y = params.stage.startY + offsetY;
  const robotClass = params.robotClass ?? 'balanced';
  const cls = ROBOT_CLASSES[robotClass] ?? ROBOT_CLASSES.balanced;

  const startPlat = params.stage.platforms.find((p) => p.kind === 'start');
  const initialFacing: 1 | -1 =
    startPlat?.nextDir ?? (params.stage.finishX < params.stage.startX - 40 ? -1 : 1);

  return {
    id: params.id,
    name: params.name,
    colorIndex: params.colorIndex,
    robotClass,
    isBot: params.isBot,
    connected: true,
    x,
    y,
    vx: 0,
    vy: 0,
    w: ROBOT_W,
    h: ROBOT_H,
    facing: initialFacing,
    onGround: false,
    coyoteTimer: 0,
    jumpBufferTimer: 0,
    prevJumpHeld: false,
    carryingPlatformId: null,
    dashTimer: 0,
    dashCooldown: 0,
    dashMaxCooldown: cls.dashCooldown,
    checkpointX: x,
    checkpointY: y,
    lastSafeY: y,
    stridePhase: 0,
    scaleX: 1,
    scaleY: 1,
    heldItem: null,
    turboTimer: 0,
    jetpackTimer: 0,
    shieldTimer: 0,
    empSlowTimer: 0,
    frostTimer: 0,
    greaseTimer: 0,
    glitchTimer: 0,
    stunTimer: 0,
    invulnTimer: 0,
    crystals: 0,
    progress: 0,
    finished: false,
    finishTime: null,
    finishRank: null,
    score: params.score ?? 0,
  };
}
