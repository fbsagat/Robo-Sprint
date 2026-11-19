import assert from 'node:assert/strict';
import test from 'node:test';
import {
  countEditorStageObjects,
  createBlankEditorStage,
  eraseEditorItemAt,
  evaluateEditorMapStandings,
  generateBotCustomStage,
  placeEditorItem,
  sanitizeSubmittedStage,
} from './editor';
import { createRobotState, stepSimulation } from './physics';
import type { MatchState, PlayerInput } from './types';

test('createBlankEditorStage creates a completely blank starter stage with only start and finish and 0 placed objects', () => {
  const stage = createBlankEditorStage(1, 'foundry', 42);
  assert.ok(stage.platforms.some((p) => p.kind === 'start'));
  assert.ok(stage.platforms.some((p) => p.kind === 'finish'));
  assert.equal(stage.platforms.length, 2);
  assert.equal(stage.itemBoxes.length, 0);
  assert.equal(stage.crystals.length, 0);
  assert.equal(stage.hazards.length, 0);
  assert.equal(stage.bouncePads.length, 0);
  assert.equal(countEditorStageObjects(stage), 0);
});

test('placeEditorItem allows placing unlimited items, platforms, hazards, and moving finish portal arbitrarily far', () => {
  let stage = createBlankEditorStage(1, 'foundry', 100);
  const initialCount = countEditorStageObjects(stage);
  assert.equal(initialCount, 0);

  // Place a solid platform, a moving platform, an item box with jetpack, a whirlwind item box, and a saw
  stage = placeEditorItem(stage, { kind: 'platform', platformKind: 'solid', width: 200 }, 900, -240);
  stage = placeEditorItem(
    stage,
    { kind: 'platform', platformKind: 'moving', width: 160, moveAxis: 'x' },
    1200,
    -320
  );
  stage = placeEditorItem(stage, { kind: 'item_box', itemType: 'jetpack' }, 900, -280);
  stage = placeEditorItem(stage, { kind: 'item_box', itemType: 'whirlwind' }, 1200, -360);
  stage = placeEditorItem(stage, { kind: 'hazard', hazardKind: 'saw' }, 920, -258);
  stage = placeEditorItem(stage, { kind: 'bounce_pad' }, 390, -58);

  assert.equal(countEditorStageObjects(stage), 6);

  // Move finish portal far away (map as large as the player wants)
  stage = placeEditorItem(stage, { kind: 'move_finish' }, 3400, -1600);
  const finishPlat = stage.platforms.find((p) => p.kind === 'finish');
  assert.ok(finishPlat);
  assert.ok(stage.horizontalSpan >= 3000);
  assert.ok(stage.targetClimb >= 1500);
});

test('eraseEditorItemAt removes multiple placed objects in radius while protecting start and finish platforms', () => {
  let stage = createBlankEditorStage(1, 'foundry', 77);
  stage = placeEditorItem(stage, { kind: 'item_box', itemType: 'turbo' }, 512, -160);
  stage = placeEditorItem(stage, { kind: 'crystal' }, 520, -160);
  assert.equal(countEditorStageObjects(stage), 2);

  const erasedBoth = eraseEditorItemAt(stage, 515, -160);
  assert.equal(erasedBoth.removed, true);
  assert.equal(countEditorStageObjects(erasedBoth.stage), 0);

  // Attempting to erase Start platform should NOT remove it
  const startPlat = erasedBoth.stage.platforms.find((p) => p.kind === 'start')!;
  const tryEraseStart = eraseEditorItemAt(
    erasedBoth.stage,
    startPlat.baseX + 40,
    startPlat.baseY + 10
  );
  assert.ok(tryEraseStart.stage.platforms.some((p) => p.kind === 'start'));

  // Attempting to erase Finish platform should NOT remove it
  const finishPlat = erasedBoth.stage.platforms.find((p) => p.kind === 'finish')!;
  const tryEraseFinish = eraseEditorItemAt(
    erasedBoth.stage,
    finishPlat.baseX + 40,
    finishPlat.baseY + 10
  );
  assert.ok(tryEraseFinish.stage.platforms.some((p) => p.kind === 'finish'));
});

test('creator playtest validation succeeds when creator robot reaches finish portal', () => {
  const stage = sanitizeSubmittedStage(createBlankEditorStage(1, 'foundry', 123));
  const creator = createRobotState({
    id: 'creator_1',
    name: 'Criador',
    colorIndex: 0,
    robotClass: 'balanced',
    isBot: false,
    stage,
    spawnSlot: 0,
  });

  // Place creator just in front of the finish portal and step simulation
  creator.x = stage.finishX + 10;
  creator.y = stage.finishY + 10;

  const match: MatchState = {
    roomCode: 'TEST',
    gameMode: 'editor',
    stageNumber: 1,
    phase: 'racing',
    countdownTimer: 0,
    raceTime: 4.2,
    stage,
    robots: [creator],
    projectiles: [],
    traps: [],
    events: [],
    nextEntityId: 500,
    podiumAutoTimer: 0,
  };

  const inputs = new Map<string, PlayerInput>([
    [
      'creator_1',
      {
        left: false,
        right: true,
        jump: false,
        jumpJustPressed: false,
        dashJustPressed: false,
        useItem: false,
      },
    ],
  ]);

  stepSimulation(match, inputs, 1 / 60);
  assert.equal(creator.finished, true);
  assert.ok(creator.finishTime !== null && creator.finishTime > 0);
});

test('generateBotCustomStage produces playable stages and evaluateEditorMapStandings identifies winner and last-place loser', () => {
  const botStage = generateBotCustomStage('Bip-01', 0, 999);
  assert.ok(botStage.platforms.some((p) => p.kind === 'start'));
  assert.ok(botStage.platforms.some((p) => p.kind === 'finish'));
  assert.ok(botStage.itemBoxes.length >= 2);

  const r1 = createRobotState({
    id: 'p1',
    name: 'Alpha',
    colorIndex: 0,
    isBot: false,
    stage: botStage,
    spawnSlot: 0,
  });
  const r2 = createRobotState({
    id: 'p2',
    name: 'Beta',
    colorIndex: 1,
    isBot: true,
    stage: botStage,
    spawnSlot: 1,
  });
  const r3 = createRobotState({
    id: 'p3',
    name: 'Gamma',
    colorIndex: 2,
    isBot: true,
    stage: botStage,
    spawnSlot: 2,
  });

  r1.finished = true;
  r1.finishRank = 1;
  r1.finishTime = 12.4;

  r2.finished = true;
  r2.finishRank = 2;
  r2.finishTime = 15.1;

  r3.finished = false;
  r3.finishRank = 3;
  r3.progress = 64;

  const evalResult = evaluateEditorMapStandings([r3, r1, r2]);
  assert.equal(evalResult.winner?.id, 'p1');
  assert.equal(evalResult.lastPlace?.id, 'p3');
  assert.equal(evalResult.pointsAwarded.get('p1'), 100);
  assert.equal(evalResult.pointsAwarded.get('p3'), 0);
});
