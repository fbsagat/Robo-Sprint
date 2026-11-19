import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_MATCH_SETTINGS, FIXED_DT, sanitizeMatchSettings } from './constants';
import { generateStage } from './generator';
import {
  activateRobotItem,
  createRobotState,
  getSortedRacers,
  pickWeightedItem,
  stepSimulation,
} from './physics';
import type { MatchState, PlayerInput } from './types';

function makeMatch(stageNumber = 1, seed = 12345): MatchState {
  const stage = generateStage(stageNumber, seed);
  const p1 = createRobotState({
    id: 'p1',
    name: 'Robo1',
    colorIndex: 0,
    robotClass: 'speedster',
    isBot: false,
    stage,
    spawnSlot: 0,
  });
  const p2 = createRobotState({
    id: 'p2',
    name: 'Robo2',
    colorIndex: 1,
    robotClass: 'jumper',
    isBot: false,
    stage,
    spawnSlot: 1,
  });
  return {
    roomCode: 'TEST',
    stageNumber,
    phase: 'racing',
    countdownTimer: 0,
    raceTime: 0,
    stage,
    robots: [p1, p2],
    projectiles: [],
    traps: [],
    events: [],
    nextEntityId: 1000,
    podiumAutoTimer: 0,
  };
}

const idleInput: PlayerInput = {
  left: false,
  right: false,
  jump: false,
  jumpJustPressed: false,
  dashJustPressed: false,
  useItem: false,
};

test('robot survives idle and executes dash burst with cooldown', () => {
  const match = makeMatch();
  const inputs = new Map<string, PlayerInput>();
  inputs.set('p1', idleInput);
  inputs.set('p2', idleInput);

  for (let i = 0; i < 60; i++) {
    stepSimulation(match, inputs, FIXED_DT);
  }
  const p1 = match.robots[0];
  assert.equal(p1.onGround, true);

  const startX = p1.x;
  inputs.set('p1', { ...idleInput, right: true, dashJustPressed: true });
  stepSimulation(match, inputs, FIXED_DT);
  assert.ok(p1.dashTimer > 0, 'Dash should become active');
  assert.ok(p1.dashCooldown > 1.0, 'Dash cooldown should trigger');

  inputs.set('p1', { ...idleInput, right: true });
  for (let i = 0; i < 10; i++) {
    stepSimulation(match, inputs, FIXED_DT);
  }
  assert.ok(p1.x > startX + 80, 'Dash should propel robot rapidly forward');
});

test('crumbling platforms shake and collapse after stepped on, then regenerate', () => {
  const match = makeMatch();
  match.stage.windZones = [];
  const p1 = match.robots[0];
  match.stage.platforms.push({
    id: 9001,
    x: 400,
    y: -140,
    baseX: 400,
    baseY: -140,
    w: 140,
    h: 24,
    kind: 'crumbling',
    crumbleState: 'intact',
    crumbleTimer: 0,
  });

  p1.x = 450;
  p1.y = -176;
  p1.vy = 80;
  const inputs = new Map<string, PlayerInput>();
  inputs.set('p1', idleInput);
  inputs.set('p2', idleInput);

  for (let i = 0; i < 4; i++) {
    stepSimulation(match, inputs, FIXED_DT);
  }
  const crumblePlat = match.stage.platforms.find((p) => p.id === 9001)!;
  assert.equal(crumblePlat.crumbleState, 'shaking');

  // Step 0.7s -> collapses
  for (let i = 0; i < 45; i++) {
    stepSimulation(match, inputs, FIXED_DT);
  }
  assert.equal(crumblePlat.crumbleState, 'fallen');

  // Step 3.0s -> regenerates
  for (let i = 0; i < 185; i++) {
    stepSimulation(match, inputs, FIXED_DT);
  }
  assert.equal(crumblePlat.crumbleState, 'intact');
});

test('glitch item inverts opponent controls and warp teleports user forward', () => {
  const match = makeMatch();
  const [p1, p2] = match.robots;
  p1.x = 120;
  p2.x = 240;
  p2.progress = 25;
  p1.progress = 10;

  // Glitch hits leader P2
  p1.heldItem = 'glitch';
  activateRobotItem(match, p1);
  assert.ok(p2.glitchTimer > 2.0, 'Glitch should affect rival leader');

  // When P2 presses right while glitched, P2 moves left
  const p2StartX = p2.x;
  const inputs = new Map<string, PlayerInput>();
  inputs.set('p1', idleInput);
  inputs.set('p2', { ...idleInput, right: true });
  for (let i = 0; i < 12; i++) {
    stepSimulation(match, inputs, FIXED_DT);
  }
  assert.ok(p2.x < p2StartX, 'Glitched robot pressing right should move left');

  // Warp moves P1 forward along the stage
  const p1BeforeWarp = p1.x;
  p1.heldItem = 'warp';
  activateRobotItem(match, p1);
  assert.ok(p1.x > p1BeforeWarp + 140, 'Warp should teleport robot ahead');
});

test('items affect user and opponents (Turbo, EMP, Shield)', () => {
  const match = makeMatch();
  const [p1, p2] = match.robots;
  p1.x = 120;
  p2.x = 240;
  p2.progress = 20;
  p1.progress = 10;

  p1.heldItem = 'turbo';
  activateRobotItem(match, p1);
  assert.ok(p1.turboTimer > 2.5);

  p1.heldItem = 'emp';
  activateRobotItem(match, p1);
  assert.ok(p2.empSlowTimer > 1.5);

  p2.empSlowTimer = 0;
  p2.heldItem = 'shield';
  activateRobotItem(match, p2);
  assert.ok(p2.shieldTimer > 4.0);

  p1.heldItem = 'emp';
  activateRobotItem(match, p1);
  assert.equal(p2.empSlowTimer, 0);
  assert.equal(p2.shieldTimer, 0);
});

test('high-altitude fall recovers relative to checkpointY without waiting for +460 abyss', () => {
  const match = makeMatch(5, 777);
  const p1 = match.robots[0];
  p1.checkpointX = 1200;
  p1.checkpointY = -1800;
  p1.x = 1260;
  p1.y = -1390; // > checkpointY + 380 (-1420), but well above stage.abyssY (+460)
  p1.vy = 400;

  const inputs = new Map<string, PlayerInput>([
    ['p1', idleInput],
    ['p2', idleInput],
  ]);

  stepSimulation(match, inputs, FIXED_DT);
  assert.equal(p1.x, 1200, 'Robot should respawn at checkpointX');
  assert.ok(p1.y <= -1800, 'Robot should respawn at high-altitude checkpointY');
});

test('bot AI maintains full jump velocity when airborne instead of cutting jump on frame 1', () => {
  const match = makeMatch(1, 999);
  const bot = match.robots[0];
  bot.isBot = true;

  // Let bot land on start platform first
  const inputs = new Map<string, PlayerInput>();
  for (let i = 0; i < 20; i++) {
    stepSimulation(match, inputs, FIXED_DT);
  }
  assert.equal(bot.onGround, true);

  // Place a saw right ahead of the bot on the start platform
  match.stage.hazards.push({
    id: 9500,
    kind: 'saw',
    x: bot.x + 40,
    baseX: bot.x + 40,
    y: bot.y + bot.h - 16,
    w: 32,
    h: 32,
    radius: 16,
  });

  // Step 1 frame -> bot initiates jump
  stepSimulation(match, inputs, FIXED_DT);
  assert.equal(bot.onGround, false);
  assert.ok(bot.vy < -550, 'Bot should launch with full jump velocity');

  // Step 2nd frame -> bot is 10px above platform; must NOT cut jump velocity in half
  stepSimulation(match, inputs, FIXED_DT);
  assert.ok(bot.vy < -500, `Bot should preserve upward jump velocity on frame 2, got ${bot.vy}`);
});

test('position-weighted item distribution prevents runaway warp in 1st and useless frost in last', () => {
  const match = makeMatch(1, 123);
  const [p1, p2] = match.robots;
  p1.progress = 60;
  p2.progress = 15;
  const sorted = getSortedRacers(match.robots);

  for (let i = 0; i < 40; i++) {
    const roll = (i + 0.5) / 40;
    const itemForLeader = pickWeightedItem(p1, sorted, () => roll);
    assert.notEqual(itemForLeader, 'warp', '1st place should never receive Warp');
    assert.notEqual(itemForLeader, 'magnet', '1st place should never receive Magnet');

    const itemForLast = pickWeightedItem(p2, sorted, () => roll);
    assert.notEqual(itemForLast, 'frost', 'Last place should never receive Frost trap');
  }
});

test('mid-air fast-fall (down input) accelerates descent and ledge forgiveness catches platform lip', () => {
  const matchA = makeMatch(1, 456);
  const matchB = makeMatch(1, 456);
  const rA = matchA.robots[0];
  const rB = matchB.robots[0];

  rA.x = 500;
  rA.y = -300;
  rA.vy = 20;
  rA.onGround = false;

  rB.x = 500;
  rB.y = -300;
  rB.vy = 20;
  rB.onGround = false;

  const inputsNormal = new Map<string, PlayerInput>([['p1', idleInput]]);
  const inputsFastFall = new Map<string, PlayerInput>([['p1', { ...idleInput, down: true }]]);

  for (let i = 0; i < 10; i++) {
    stepSimulation(matchA, inputsNormal, FIXED_DT);
    stepSimulation(matchB, inputsFastFall, FIXED_DT);
  }
  assert.ok(rB.y > rA.y + 18, 'Fast-fall should descend significantly faster than normal fall');

  // Test 14px ledge forgiveness on a platform at y = -100
  matchA.stage.platforms.push({
    id: 9800,
    x: 800,
    y: -100,
    baseX: 800,
    baseY: -100,
    w: 120,
    h: 28,
    kind: 'solid',
  });
  rA.x = 805;
  rA.y = -100 - rA.h + 13; // Feet 13px below top surface (within 16px ledge tolerance)
  rA.vy = 30;
  rA.onGround = false;

  stepSimulation(matchA, inputsNormal, FIXED_DT);
  assert.equal(rA.onGround, true, 'Ledge forgiveness should snap robot onto platform');
  assert.equal(rA.y, -100 - rA.h);
});

test('falling returns robot to start of stage before checkpoint, and to checkpoint after activating one', () => {
  const match = makeMatch(1, 2026);
  const p1 = match.robots[0];
  const initialStartX = p1.checkpointX;
  const initialStartY = p1.checkpointY;

  const solidPlat = match.stage.platforms.find((p) => p.kind === 'solid')!;
  const checkpointPlat = match.stage.platforms.find((p) => p.kind === 'checkpoint')!;
  assert.ok(solidPlat, 'Stage should have solid platforms');
  assert.ok(checkpointPlat, 'Stage should have checkpoint platforms');

  const inputs = new Map<string, PlayerInput>([
    ['p1', idleInput],
    ['p2', idleInput],
  ]);

  // 1. Land on a regular solid platform -> checkpoint must remain at Start of Stage
  p1.x = solidPlat.x + 20;
  p1.y = solidPlat.y - p1.h - 2;
  p1.vy = 40;
  for (let i = 0; i < 4; i++) {
    stepSimulation(match, inputs, FIXED_DT);
  }
  assert.equal(p1.onGround, true);
  assert.equal(p1.checkpointX, initialStartX, 'Solid platform must not overwrite start checkpointX');
  assert.equal(p1.checkpointY, initialStartY, 'Solid platform must not overwrite start checkpointY');

  // Fall off solid platform -> must return to Start of Stage
  p1.onGround = false;
  p1.y = p1.lastSafeY + 280;
  stepSimulation(match, inputs, FIXED_DT);
  assert.equal(p1.x, initialStartX, 'Falling before checkpoint must return robot to startX');
  assert.ok(Math.abs(p1.y - (initialStartY - 10)) <= 1, 'Falling before checkpoint must return robot to startY');

  // 2. Reach a Checkpoint platform -> checkpoint updates to Checkpoint platform
  p1.x = checkpointPlat.x + 20;
  p1.y = checkpointPlat.y - p1.h - 2;
  p1.vy = 40;
  for (let i = 0; i < 4; i++) {
    stepSimulation(match, inputs, FIXED_DT);
  }
  assert.ok(p1.checkpointX > initialStartX + 100, 'Checkpoint platform must advance checkpointX');
  const savedCpX = p1.checkpointX;
  const savedCpY = p1.checkpointY;

  // Fall after checkpoint -> must return to the Checkpoint
  p1.x = savedCpX + 320;
  p1.y = p1.lastSafeY + 280;
  stepSimulation(match, inputs, FIXED_DT);
  assert.equal(p1.x, savedCpX, 'Falling after checkpoint must return robot to checkpointX');
  assert.ok(Math.abs(p1.y - (savedCpY - 10)) <= 1, 'Falling after checkpoint must return robot to checkpointY');
});

test('smart bot AI autonomously navigates across multiple gaps and climbs forward', () => {
  const match = makeMatch(1, 2026);
  for (const r of match.robots) {
    r.isBot = true;
  }
  const initialX = match.robots[0].x;
  const inputs = new Map<string, PlayerInput>();

  // Simulate 8 seconds (480 frames) of autonomous bot racing
  for (let i = 0; i < 480; i++) {
    stepSimulation(match, inputs, FIXED_DT);
  }

  const bestBotX = Math.max(...match.robots.map((r) => r.x));
  assert.ok(
    bestBotX > initialX + 650,
    `Smart bots should cross multiple gaps and advance >650px in 8s (got bestBotX=${bestBotX})`
  );
});

test('precision controls: mid-air braking stops drift quickly and counter-strafing reverses instantly', () => {
  const match = makeMatch(1, 555);
  const p1 = match.robots[0];
  p1.x = 400;
  p1.y = -200;
  p1.vx = 335;
  p1.vy = 0;
  p1.onGround = false;

  const inputs = new Map<string, PlayerInput>([
    ['p1', idleInput],
    ['p2', idleInput],
  ]);

  // Release keys in mid-air -> should brake to 0 within 6 frames (0.10s)
  for (let i = 0; i < 6; i++) {
    stepSimulation(match, inputs, FIXED_DT);
  }
  assert.equal(p1.vx, 0, 'Mid-air release should brake horizontal drift to 0 within 0.1s');

  // Counter-strafing: moving right at 335, then pressing left should reverse direction within 5 frames
  p1.vx = 335;
  inputs.set('p1', { ...idleInput, left: true });
  for (let i = 0; i < 5; i++) {
    stepSimulation(match, inputs, FIXED_DT);
  }
  assert.ok(p1.vx < 0, `Counter-strafing should reverse velocity to negative within 5 frames, got ${p1.vx}`);
});

test('new stage objects: boostRings, bumpers, crystals, and stomping hover drones', () => {
  const match = makeMatch(1, 888);
  const p1 = match.robots[0];
  const inputs = new Map<string, PlayerInput>([
    ['p1', idleInput],
    ['p2', idleInput],
  ]);

  // 1. Collect energy crystal
  match.stage.crystals = [{ id: 7001, x: p1.x + 14, y: p1.y + 17, respawnAt: 0 }];
  p1.dashCooldown = 1.0;
  stepSimulation(match, inputs, FIXED_DT);
  assert.equal(p1.crystals, 1, 'Collecting crystal should increment crystals count');
  assert.ok(p1.dashCooldown < 0.7, 'Collecting crystal should reduce dashCooldown');

  // 2. Pass through BoostRing
  match.stage.boostRings = [
    { id: 7002, x: p1.x + 14, y: p1.y + 17, r: 22, boostVx: 470, boostVy: -350 },
  ];
  p1.dashCooldown = 1.5;
  stepSimulation(match, inputs, FIXED_DT);
  assert.ok(p1.vx >= 450, 'BoostRing should propel robot forward');
  assert.ok(p1.vy <= -300, 'BoostRing should launch robot upward');
  assert.equal(p1.dashCooldown, 0, 'BoostRing should reset dashCooldown');

  // 3. Stomp a hovering patrol drone from above -> bounces upward without hurting
  match.stage.boostRings = [];
  match.stage.hazards = [
    {
      id: 7003,
      kind: 'drone',
      x: 500,
      baseX: 500,
      y: -100,
      baseY: -100,
      w: 28,
      h: 20,
      radius: 14,
    },
  ];
  p1.x = 500;
  p1.y = -100 - p1.h - 2; // Descending onto top dome of drone
  p1.vx = 0;
  p1.vy = 180;
  p1.stunTimer = 0;
  stepSimulation(match, inputs, FIXED_DT);
  assert.ok(p1.vy <= -500, `Stomping top of drone should bounce robot upward, got vy=${p1.vy}`);
  assert.equal(p1.stunTimer, 0, 'Stomping top of drone must not stun/hurt the robot');
});

test('new items: barrier blocks rivals, grease causes slippery traction loss, and whirlwind launches robots super high', () => {
  const match = makeMatch(1, 777);
  const [p1, p2] = match.robots;
  const inputs = new Map<string, PlayerInput>([
    ['p1', idleInput],
    ['p2', idleInput],
  ]);

  // 1. ItemBox grants the exact visible itemType inside the box
  match.stage.itemBoxes = [
    { id: 8100, x: p1.x, y: p1.y, itemType: 'barrier', respawnAt: 0 },
  ];
  p1.heldItem = null;
  stepSimulation(match, inputs, FIXED_DT);
  assert.equal(p1.heldItem, 'barrier', 'Picking up an ItemBox must grant its visible itemType');

  // 2. Barrier deploys behind p1 and bounces rival p2 backward with stun
  p1.x = 200;
  p1.y = -34;
  p1.facing = 1;
  activateRobotItem(match, p1);
  const barrierTrap = match.traps.find((t) => t.kind === 'barrier');
  assert.ok(barrierTrap, 'Activating barrier should spawn a barrier trap');

  p2.x = barrierTrap.x;
  p2.y = barrierTrap.y + 10;
  p2.invulnTimer = 0;
  p2.shieldTimer = 0;
  stepSimulation(match, inputs, FIXED_DT);
  assert.ok(p2.stunTimer > 0.2, 'Rival hitting barrier should be stunned and repelled');
  assert.ok(p2.vy < -150, 'Rival hitting barrier should be bounced upward/backward');

  // 3. Grease slick coats floor and causes rival p2 to lose traction (greaseTimer > 0)
  p2.stunTimer = 0;
  p2.invulnTimer = 0;
  p1.heldItem = 'grease';
  activateRobotItem(match, p1);
  const greaseTrap = match.traps.find((t) => t.kind === 'grease_slick');
  assert.ok(greaseTrap, 'Activating grease should spawn a grease_slick trap');

  p2.x = greaseTrap.x + 10;
  p2.y = greaseTrap.y - p2.h + 2;
  stepSimulation(match, inputs, FIXED_DT);
  assert.ok(p2.greaseTimer > 2.0, 'Rival touching grease slick should receive greaseTimer slip effect');

  // 4. Whirlwind launches robot very high into the air (vy <= -1000) and leaves a cyclone that launches rivals
  p1.onGround = true;
  p1.vy = 0;
  p1.heldItem = 'whirlwind';
  activateRobotItem(match, p1);
  assert.ok(p1.vy <= -1000, `Whirlwind should launch robot very high upward, got vy=${p1.vy}`);

  const whirlwindTrap = match.traps.find((t) => t.kind === 'whirlwind');
  assert.ok(whirlwindTrap, 'Whirlwind should also spawn a cyclone vortex on the track');
  p2.x = whirlwindTrap.x + 4;
  p2.y = whirlwindTrap.y + 10;
  p2.vy = 0;
  p2.shieldTimer = 0;
  stepSimulation(match, inputs, FIXED_DT);
  assert.ok(p2.vy <= -1000, `Rival hitting whirlwind vortex must be thrown very high upward, got vy=${p2.vy}`);
});

test('human-like bot AI archetypes autonomously finish full S-curve procedural stages', () => {
  for (const [stageNum, seed] of [
    [1, 12345],
    [2, 54321],
    [3, 99999],
  ] as const) {
    const stage = generateStage(stageNum, seed);
    const bots = [0, 1, 2, 3].map((idx) =>
      createRobotState({
        id: `bot-${idx}`,
        name: `Bot-${idx}`,
        colorIndex: idx,
        robotClass: idx === 0 ? 'speedster' : idx === 1 ? 'jumper' : 'balanced',
        isBot: true,
        stage,
        spawnSlot: idx,
      })
    );
    const match: MatchState = {
      roomCode: 'BOTS',
      phase: 'racing',
      stageNumber: stageNum,
      countdownTimer: 0,
      raceTime: 0,
      podiumAutoTimer: 0,
      stage,
      robots: bots,
      projectiles: [],
      traps: [],
      events: [],
      nextEntityId: 1,
    };

    const inputs = new Map<string, PlayerInput>();
    let spreadObserved = false;

    // Simulate up to 65 seconds of race time
    for (let f = 0; f < 60 * 65; f++) {
      stepSimulation(match, inputs, FIXED_DT);
      if (f === 60 * 5) {
        const xs = bots.map((b) => Math.round(b.x));
        const uniqueXs = new Set(xs);
        if (uniqueXs.size >= 2) {
          spreadObserved = true;
        }
      }
      if (bots.some((b) => b.finished)) {
        break;
      }
    }

    const finishedBots = bots.filter((b) => b.finished);
    const maxProgress = Math.max(...bots.map((b) => b.progress));
    assert.ok(
       spreadObserved,
      `Bots on stage ${stageNum} should move with human-like individual pacing instead of lockstep`
    );
    assert.ok(
      finishedBots.length >= 1,
      `Bots must be able to finish stage ${stageNum} (seed=${seed}); maxProgress=${maxProgress}%`
    );
  }
});

test('jetpack item activates upward thrust, sustains flight while holding jump, and empowers bot flight', () => {
  const match = makeMatch(2, 4242);
  const [p1] = match.robots;
  const startY = p1.y;

  // Activate Jetpack
  p1.heldItem = 'jetpack';
  activateRobotItem(match, p1);
  assert.equal(p1.heldItem, null, 'Jetpack should be consumed on activation');
  assert.ok(p1.jetpackTimer >= 3.5, 'Jetpack timer should be active (~3.8s)');
  assert.ok(p1.vy <= -450, 'Jetpack activation should provide immediate takeoff upward velocity');

  // Hold jump & right for 25 frames and verify sustained upward ascent + horizontal boost
  const flyInputs = new Map<string, PlayerInput>([
    ['p1', { ...idleInput, right: true, jump: true }],
    ['p2', idleInput],
  ]);
  for (let i = 0; i < 25; i++) {
    stepSimulation(match, flyInputs, FIXED_DT);
  }

  assert.ok(p1.y < startY - 120, `Robot holding jump with active Jetpack should climb high (startY=${startY}, y=${p1.y})`);
  assert.ok(p1.vx > 320, `Jetpack should boost horizontal flight speed (vx=${p1.vx})`);
});

test('fall detection allows diving far below Start or high platforms to reach a lower Finish Portal objective', () => {
  const match = makeMatch(1, 3030);
  match.gameMode = 'editor';
  const p1 = match.robots[0];

  // Clear intermediate procedural platforms so p1 can dive unobstructed from y = -700 to y = +900
  match.stage.platforms = match.stage.platforms.filter(
    (p) => p.kind === 'start' || p.kind === 'finish'
  );

  // Move the Finish Portal 900px BELOW the Start platform (y = +900)
  match.stage.finishX = 360;
  match.stage.finishY = 900;
  match.stage.finishW = 72;
  match.stage.finishH = 88;

  // Also test diving from a high platform (lastSafeY = -750) all the way down to y = +900
  p1.lastSafeY = -750;
  p1.checkpointY = -34;
  p1.x = 370;
  p1.y = -700;
  p1.vx = 0;
  p1.vy = 500;
  p1.onGround = false;

  const inputs = new Map<string, PlayerInput>([
    ['p1', idleInput],
    ['p2', idleInput],
  ]);

  let fallResetTriggered = false;
  for (let i = 0; i < 180; i++) {
    stepSimulation(match, inputs, FIXED_DT);
    if (match.events.some((e) => e.type === 'fall_reset' && e.actorId === 'p1')) {
      fallResetTriggered = true;
    }
    if (p1.finished) break;
  }

  assert.equal(
    fallResetTriggered,
    false,
    'Diving downward toward a lower Finish Portal must never trigger a premature fall_reset'
  );
  assert.equal(p1.finished, true, 'Robot diving down to lower Finish Portal must reach and complete the objective');
});

test('360-degree directional freedom allows moving and building far to the left of the Start platform (x < 0)', () => {
  const match = makeMatch(1, 4040);
  match.gameMode = 'editor';
  const p1 = match.robots[0];

  // Place a platform and the Finish Portal to the LEFT of the Start platform (negative X)
  match.stage.platforms.push({
    id: 9910,
    x: -420,
    y: 0,
    w: 500,
    h: 26,
    kind: 'solid',
    baseX: -420,
    baseY: 0,
  });
  match.stage.finishX = -360;
  match.stage.finishY = -88;
  match.stage.finishW = 72;
  match.stage.finishH = 88;

  const leftInputs = new Map<string, PlayerInput>([
    ['p1', { ...idleInput, left: true }],
    ['p2', idleInput],
  ]);

  for (let i = 0; i < 140; i++) {
    stepSimulation(match, leftInputs, FIXED_DT);
    if (p1.finished) break;
  }

  assert.ok(p1.x < -200, `Robot must be able to travel freely to negative X left of Start (got x=${p1.x})`);
  assert.equal(p1.finished, true, 'Robot must be able to reach Finish Portal placed to the left of Start');
});

test('map_preview observation session animates stage dynamics and transitions to countdown when timer expires', () => {
  const match = makeMatch(1, 5050);
  match.gameMode = 'editor';
  match.phase = 'map_preview';
  match.countdownTimer = 0.5;
  const p1 = match.robots[0];
  const initialX = p1.x;

  const inputs = new Map<string, PlayerInput>([
    ['p1', { ...idleInput, right: true, jump: true }],
    ['p2', idleInput],
  ]);

  // Step 10 frames (0.16s): still in map_preview, robot stays at starting line
  for (let i = 0; i < 10; i++) {
    stepSimulation(match, inputs, FIXED_DT);
  }
  assert.equal(match.phase, 'map_preview');
  assert.equal(p1.x, initialX, 'Robots must remain stationary at the starting line during map_preview');

  // Step remaining frames past 0.5s: transitions to countdown
  for (let i = 0; i < 30; i++) {
    stepSimulation(match, inputs, FIXED_DT);
  }
  assert.equal(match.phase, 'countdown', 'Match must transition from map_preview to countdown when timer expires');
});

test('MatchSettings customize procedural generation (biome, length, items, hazards) and physics (speed & gravity)', () => {
  const sanitized = sanitizeMatchSettings({
    speedMultiplier: 1.5,
    gravityMultiplier: 0.65,
    itemFrequency: 'none',
    hazardsEnabled: false,
    classicStageLength: 'short',
    classicBiome: 'orbital_core',
    classicTargetStages: 5,
    editorBuildTimeLimit: 180,
    editorCourseTimeLimit: 60,
    editorPreviewSeconds: 8,
  });

  assert.equal(sanitized.speedMultiplier, 1.5);
  assert.equal(sanitized.gravityMultiplier, 0.65);
  assert.equal(sanitized.itemFrequency, 'none');
  assert.equal(sanitized.hazardsEnabled, false);
  assert.equal(sanitized.classicBiome, 'orbital_core');

  // Generate stage with custom settings
  const customStage = generateStage(2, 7777, sanitized);
  const defaultStage = generateStage(2, 7777, DEFAULT_MATCH_SETTINGS);
  assert.equal(customStage.biome, 'orbital_core', 'Custom biome should override auto rotation');
  assert.equal(customStage.itemBoxes.length, 0, 'itemFrequency="none" must spawn zero item boxes');
  assert.equal(customStage.hazards.length, 0, 'hazardsEnabled=false must omit all stage hazards');
  assert.ok(
    customStage.platforms.length < defaultStage.platforms.length,
    `Short stage (${customStage.platforms.length} platforms) must have fewer platforms than normal stage (${defaultStage.platforms.length})`
  );

  // Verify speedMultiplier increases robot sprint distance
  const normalMatch = makeMatch(1, 8888);
  const fastMatch = makeMatch(1, 8888);
  fastMatch.matchSettings = { ...DEFAULT_MATCH_SETTINGS, speedMultiplier: 1.5 };

  const rightInput = new Map<string, PlayerInput>([
    ['p1', { ...idleInput, right: true }],
    ['p2', idleInput],
  ]);

  for (let i = 0; i < 30; i++) {
    stepSimulation(normalMatch, rightInput, FIXED_DT);
    stepSimulation(fastMatch, rightInput, FIXED_DT);
  }

  assert.ok(
    fastMatch.robots[0].x > normalMatch.robots[0].x + 40,
    `1.5x speedMultiplier should move robot significantly farther (${fastMatch.robots[0].x} vs ${normalMatch.robots[0].x})`
  );
});

