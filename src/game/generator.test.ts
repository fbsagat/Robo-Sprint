import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canJumpBetween,
  generateStage,
  verifyStageCompletable,
} from './generator';

test('procedural stages grow horizontally, climb higher, and progress through biomes', () => {
  const seed = 424242;
  const stage1 = generateStage(1, seed);
  const stage3 = generateStage(3, seed);
  const stage5 = generateStage(5, seed);

  assert.equal(stage1.biome, 'foundry');
  assert.equal(stage3.biome, 'wind_tower');
  assert.equal(stage5.biome, 'orbital_core');

  assert.ok(stage3.horizontalSpan > stage1.horizontalSpan);
  assert.ok(stage5.horizontalSpan > stage3.horizontalSpan);

  assert.ok(stage3.targetClimb > stage1.targetClimb);
  assert.ok(stage5.targetClimb > stage3.targetClimb);
  assert.ok(stage5.finishY < stage3.finishY);
  assert.ok(stage3.finishY < stage1.finishY);
});

test('100% of generated stages across levels 1..30 and multiple seeds pass BFS reachability', () => {
  const seeds = [101, 2026, 987654, 1337, 55555];
  const levels = [1, 2, 3, 4, 5, 8, 12, 20, 30];

  for (const seed of seeds) {
    for (const lvl of levels) {
      const stage = generateStage(lvl, seed);
      const report = verifyStageCompletable(stage);
      assert.equal(
        report.completable,
        true,
        `Stage ${lvl} with seed ${seed} must be completable (furthestX=${report.furthestX})`
      );
      assert.ok(stage.itemBoxes.length >= 2);
    }
  }
});

test('stages spawn rich interactive objects (boostRings, bumpers, crystals, drones, conveyors, crumbling, wind zones)', () => {
  const stages = [1, 2, 3, 4].map((lvl) => generateStage(lvl, 999888));
  const hasConveyor = stages.some((s) => s.platforms.some((p) => p.kind === 'conveyor'));
  const hasCrumbling = stages.some((s) => s.platforms.some((p) => p.kind === 'crumbling'));
  const hasWind = stages.some((s) => s.windZones.length > 0);
  const hasBoostRings = stages.some((s) => s.boostRings.length > 0);
  const hasBumpers = stages.some((s) => s.bumpers.length > 0);
  const hasCrystals = stages.every((s) => s.crystals.length >= 6);
  const hasDrone = stages.some((s) => s.hazards.some((h) => h.kind === 'drone'));

  assert.equal(hasConveyor, true, 'Stages should include conveyor platforms');
  assert.equal(hasCrumbling, true, 'Stages should include crumbling platforms');
  assert.equal(hasWind, true, 'Stages should include wind updraft zones');
  assert.equal(hasBoostRings, true, 'Stages should include mid-air boost rings');
  assert.equal(hasBumpers, true, 'Stages should include electromagnetic bumpers');
  assert.equal(hasCrystals, true, 'Every stage should include energy crystal arches');
  assert.equal(hasDrone, true, 'Stages should include hovering patrol drones');
});

test('verifyStageCompletable rejects an unreachable gap', () => {
  const brokenStage = generateStage(1, 777);
  const finishPlat = brokenStage.platforms.find((p) => p.kind === 'finish')!;
  finishPlat.baseX += 1800;
  finishPlat.x = finishPlat.baseX;
  finishPlat.baseY -= 900;
  finishPlat.y = finishPlat.baseY;

  const report = verifyStageCompletable(brokenStage);
  assert.equal(report.completable, false);
});

test('canJumpBetween accounts for bounce pads enabling higher vertical climbs', () => {
  const from = {
    id: 1,
    x: 0,
    y: 0,
    baseX: 0,
    baseY: 0,
    w: 200,
    h: 28,
    kind: 'solid' as const,
  };
  const highTarget = {
    id: 2,
    x: 240,
    y: -175,
    baseX: 240,
    baseY: -175,
    w: 140,
    h: 28,
    kind: 'solid' as const,
  };

  assert.equal(canJumpBetween(from, highTarget, [], []), false);

  const pad = { id: 3, x: 140, y: -14, w: 44, h: 14, power: -950 };
  assert.equal(canJumpBetween(from, highTarget, [pad], []), true);
});

test('stages generate dynamic S-shaped switchback paths and scattered item boxes with visible itemType', () => {
  const stage1 = generateStage(1, 314159);
  const stage5 = generateStage(5, 314159);

  const sCurvePlats1 = stage1.platforms.filter((p) => p.nextDir === -1);
  const sCurvePlats5 = stage5.platforms.filter((p) => p.nextDir === -1);

  assert.ok(
    sCurvePlats1.length >= 2,
    'Stage 1 should include leftward switchback platforms forming an S-curve'
  );
  assert.ok(
    sCurvePlats5.length > sCurvePlats1.length,
    'Higher levels should have progressively more dynamic S-curve switchback segments'
  );

  // Every item box must carry a valid visible itemType and be scattered across the map
  assert.ok(stage1.itemBoxes.length >= 6, 'Stage should spawn multiple scattered item boxes');
  for (const box of stage1.itemBoxes) {
    assert.ok(box.itemType, 'Every item box must display its contained itemType');
  }
  const hasNewItemsInBoxes = stage5.itemBoxes.some(
    (b) => b.itemType === 'barrier' || b.itemType === 'grease' || b.itemType === 'whirlwind'
  );
  assert.equal(
    hasNewItemsInBoxes,
    true,
    'Scattered item boxes must include the new barrier, grease, and whirlwind items'
  );
});
