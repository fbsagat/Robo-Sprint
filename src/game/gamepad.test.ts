import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyWheelZoom,
  CAMERA_MAX_ZOOM,
  CAMERA_MIN_ZOOM,
  CAMERA_ZOOM_LEVELS,
  createGamepadMemoryState,
  cycleCameraZoomLevel,
  extractGamepadInput,
  stepCameraZoomLevel,
  type GamepadLike,
} from './gamepad';

function createMockGamepad(overrides?: {
  axes?: number[];
  pressedButtons?: number[];
}): GamepadLike {
  const pressedSet = new Set(overrides?.pressedButtons ?? []);
  const buttons = Array.from({ length: 16 }, (_, idx) => ({
    pressed: pressedSet.has(idx),
    value: pressedSet.has(idx) ? 1 : 0,
  }));
  return {
    id: 'Xbox Wireless Controller (STANDARD GAMEPAD)',
    connected: true,
    axes: overrides?.axes ?? [0, 0, 0, 0],
    buttons,
  };
}

test('camera zoom supports 10 levels and cycles / steps cleanly', () => {
  assert.equal(CAMERA_ZOOM_LEVELS.length, 10);
  assert.equal(CAMERA_MIN_ZOOM, 0.55);
  assert.equal(CAMERA_MAX_ZOOM, 2.4);

  // Cycling from 1.35 should advance through 1.55 -> 1.8 -> 2.1 -> 2.4 -> wrap to 0.55
  const z1 = cycleCameraZoomLevel(1.35);
  assert.equal(z1, 1.55);
  const z2 = cycleCameraZoomLevel(z1);
  assert.equal(z2, 1.8);
  const z3 = cycleCameraZoomLevel(2.4);
  assert.equal(z3, 0.55);

  // Stepping in (+1) and out (-1)
  assert.equal(stepCameraZoomLevel(1.35, 1), 1.55);
  assert.equal(stepCameraZoomLevel(1.35, -1), 1.15);
  assert.equal(stepCameraZoomLevel(CAMERA_MAX_ZOOM, 1), CAMERA_MAX_ZOOM);
  assert.equal(stepCameraZoomLevel(CAMERA_MIN_ZOOM, -1), CAMERA_MIN_ZOOM);
});

test('applyWheelZoom zooms in on scroll up (deltaY < 0) and zooms out on scroll down (deltaY > 0)', () => {
  const startZoom = 1.35;
  const zoomedIn = applyWheelZoom(startZoom, -100);
  assert.ok(zoomedIn > startZoom, `Expected ${zoomedIn} > ${startZoom}`);

  const zoomedOut = applyWheelZoom(startZoom, 100);
  assert.ok(zoomedOut < startZoom, `Expected ${zoomedOut} < ${startZoom}`);

  // Clamping at boundaries
  assert.equal(applyWheelZoom(2.38, -500), CAMERA_MAX_ZOOM);
  assert.equal(applyWheelZoom(0.58, 500), CAMERA_MIN_ZOOM);
});

test('extractGamepadInput maps left stick, D-pad, jump, dash, item, and right-stick zoom with edge triggers', () => {
  const mem = createGamepadMemoryState();

  // Frame 1: Push left stick right (+0.85), press A (0 = Jump), RB (5 = Dash), Y (3 = Use Item)
  const pad1 = createMockGamepad({
    axes: [0.85, 0, 0, -0.75],
    pressedButtons: [0, 3, 5],
  });
  const res1 = extractGamepadInput([pad1], mem);
  assert.equal(res1.connected, true);
  assert.equal(res1.right, true);
  assert.equal(res1.left, false);
  assert.equal(res1.jump, true);
  assert.equal(res1.jumpJustPressed, true);
  assert.equal(res1.dashJustPressed, true);
  assert.equal(res1.useItemJustPressed, true);
  assert.ok(res1.zoomDelta > 0); // Right stick pushed up -> zoom in

  // Frame 2: Hold buttons -> edge triggers (justPressed) must be false while jump remains held
  const res2 = extractGamepadInput([pad1], mem);
  assert.equal(res2.jump, true);
  assert.equal(res2.jumpJustPressed, false);
  assert.equal(res2.dashJustPressed, false);
  assert.equal(res2.useItemJustPressed, false);

  // Frame 3: D-Pad Left (14) and D-Pad Down (13) for fast-fall
  const pad3 = createMockGamepad({
    axes: [0, 0, 0, 0],
    pressedButtons: [13, 14],
  });
  const res3 = extractGamepadInput([pad3], mem);
  assert.equal(res3.left, true);
  assert.equal(res3.down, true);
  assert.equal(res3.jump, false);
});
