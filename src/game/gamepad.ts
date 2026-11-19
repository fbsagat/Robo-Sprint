export const CAMERA_ZOOM_LEVELS = [
  0.55,
  0.7,
  0.85,
  1.0,
  1.15,
  1.35,
  1.55,
  1.8,
  2.1,
  2.4,
] as const;

export const CAMERA_MIN_ZOOM = CAMERA_ZOOM_LEVELS[0];
export const CAMERA_MAX_ZOOM = CAMERA_ZOOM_LEVELS[CAMERA_ZOOM_LEVELS.length - 1];
export const CAMERA_DEFAULT_ZOOM = 1.35;

export function clampCameraZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return CAMERA_DEFAULT_ZOOM;
  return Math.max(
    CAMERA_MIN_ZOOM,
    Math.min(CAMERA_MAX_ZOOM, Math.round(zoom * 100) / 100)
  );
}

/**
 * Computes next zoom level when cycling with the Zoom button or 'Z' / R3 key.
 */
export function cycleCameraZoomLevel(currentZoom: number): number {
  let closestIdx = 0;
  let bestDiff = Infinity;
  for (let i = 0; i < CAMERA_ZOOM_LEVELS.length; i++) {
    const diff = Math.abs(CAMERA_ZOOM_LEVELS[i] - currentZoom);
    if (diff < bestDiff) {
      bestDiff = diff;
      closestIdx = i;
    }
  }
  const nextIdx = (closestIdx + 1) % CAMERA_ZOOM_LEVELS.length;
  return CAMERA_ZOOM_LEVELS[nextIdx];
}

/**
 * Steps to the next discrete zoom level in (+1) or out (-1).
 */
export function stepCameraZoomLevel(currentZoom: number, direction: 1 | -1): number {
  if (direction > 0) {
    for (const lvl of CAMERA_ZOOM_LEVELS) {
      if (lvl > currentZoom + 0.03) return lvl;
    }
    return CAMERA_MAX_ZOOM;
  } else {
    for (let i = CAMERA_ZOOM_LEVELS.length - 1; i >= 0; i--) {
      if (CAMERA_ZOOM_LEVELS[i] < currentZoom - 0.03) return CAMERA_ZOOM_LEVELS[i];
    }
    return CAMERA_MIN_ZOOM;
  }
}

/**
 * Computes new zoom from mouse wheel deltaY (negative deltaY = scroll up = zoom in,
 * positive deltaY = scroll down = zoom out).
 */
export function applyWheelZoom(currentZoom: number, deltaY: number): number {
  if (!Number.isFinite(deltaY) || deltaY === 0) return clampCameraZoom(currentZoom);
  // Support both smooth trackpads and notched mouse wheels
  const normalized = Math.max(-1.6, Math.min(1.6, -deltaY / 100));
  const step = Math.abs(normalized) < 0.25 ? Math.sign(normalized) * 0.1 : normalized * 0.14;
  return clampCameraZoom(currentZoom + step);
}

export interface GamepadButtonLike {
  pressed: boolean;
  value?: number;
}

export interface GamepadLike {
  id?: string;
  connected?: boolean;
  axes: readonly number[];
  buttons: readonly GamepadButtonLike[];
}

export interface GamepadMemoryState {
  prevJump: boolean;
  prevDash: boolean;
  prevUseItem: boolean;
  prevPause: boolean;
  prevZoomCycle: boolean;
  prevPrimaryClick: boolean;
  prevSecondaryClick: boolean;
}

export function createGamepadMemoryState(): GamepadMemoryState {
  return {
    prevJump: false,
    prevDash: false,
    prevUseItem: false,
    prevPause: false,
    prevZoomCycle: false,
    prevPrimaryClick: false,
    prevSecondaryClick: false,
  };
}

export interface PolledGamepadInput {
  connected: boolean;
  controllerName: string | null;
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
  jump: boolean;
  jumpJustPressed: boolean;
  dashJustPressed: boolean;
  useItemJustPressed: boolean;
  pauseJustPressed: boolean;
  zoomCycleJustPressed: boolean;
  zoomDelta: number; // From right stick vertical axis
  moveX: number; // Continuous [-1..1] for editor camera panning
  moveY: number; // Continuous [-1..1] for editor camera panning
  primaryActionJustPressed: boolean;
  secondaryActionJustPressed: boolean;
}

function isBtnPressed(buttons: readonly GamepadButtonLike[], index: number, threshold = 0.35): boolean {
  const b = buttons[index];
  if (!b) return false;
  return Boolean(b.pressed || (typeof b.value === 'number' && b.value >= threshold));
}

/**
 * Extracts normalized gameplay & camera controls from an array of Gamepad objects
 * and updates edge-trigger memory state.
 */
export function extractGamepadInput(
  gamepads: ReadonlyArray<GamepadLike | null | undefined>,
  memory: GamepadMemoryState
): PolledGamepadInput {
  let activePad: GamepadLike | null = null;
  for (const pad of gamepads) {
    if (pad && pad.connected !== false) {
      activePad = pad;
      break;
    }
  }

  if (!activePad) {
    memory.prevJump = false;
    memory.prevDash = false;
    memory.prevUseItem = false;
    memory.prevPause = false;
    memory.prevZoomCycle = false;
    memory.prevPrimaryClick = false;
    memory.prevSecondaryClick = false;
    return {
      connected: false,
      controllerName: null,
      left: false,
      right: false,
      up: false,
      down: false,
      jump: false,
      jumpJustPressed: false,
      dashJustPressed: false,
      useItemJustPressed: false,
      pauseJustPressed: false,
      zoomCycleJustPressed: false,
      zoomDelta: 0,
      moveX: 0,
      moveY: 0,
      primaryActionJustPressed: false,
      secondaryActionJustPressed: false,
    };
  }

  const axes = activePad.axes ?? [];
  const buttons = activePad.buttons ?? [];

  const rawX = axes[0] ?? 0;
  const rawY = axes[1] ?? 0;
  const rawRightY = axes[3] ?? 0;

  const deadzone = 0.22;
  const dpadUp = isBtnPressed(buttons, 12);
  const dpadDown = isBtnPressed(buttons, 13);
  const dpadLeft = isBtnPressed(buttons, 14);
  const dpadRight = isBtnPressed(buttons, 15);

  const left = rawX < -deadzone || dpadLeft;
  const right = rawX > deadzone || dpadRight;
  const up = rawY < -0.4 || dpadUp;
  const down = rawY > 0.45 || dpadDown;

  // Jump: South (A / Cross = 0), East (B / Circle = 1), or D-Pad Up (12)
  const jump =
    isBtnPressed(buttons, 0) ||
    isBtnPressed(buttons, 1) ||
    dpadUp;

  // Dash: West (X / Square = 2), RB/R1 (5), or RT/R2 (7)
  const dash =
    isBtnPressed(buttons, 2) ||
    isBtnPressed(buttons, 5) ||
    isBtnPressed(buttons, 7);

  // Use Item: North (Y / Triangle = 3), LB/L1 (4), or LT/L2 (6)
  const useItem =
    isBtnPressed(buttons, 3) ||
    isBtnPressed(buttons, 4) ||
    isBtnPressed(buttons, 6);

  // Pause / Start: Start/Options (9) or Select/Back (8)
  const pause = isBtnPressed(buttons, 9);

  // Zoom Cycle: R3 (11) or Select/Back (8)
  const zoomCycle = isBtnPressed(buttons, 11) || isBtnPressed(buttons, 8);

  const primaryClick = isBtnPressed(buttons, 0);
  const secondaryClick = isBtnPressed(buttons, 1) || isBtnPressed(buttons, 2);

  const jumpJustPressed = jump && !memory.prevJump;
  const dashJustPressed = dash && !memory.prevDash;
  const useItemJustPressed = useItem && !memory.prevUseItem;
  const pauseJustPressed = pause && !memory.prevPause;
  const zoomCycleJustPressed = zoomCycle && !memory.prevZoomCycle;
  const primaryActionJustPressed = primaryClick && !memory.prevPrimaryClick;
  const secondaryActionJustPressed = secondaryClick && !memory.prevSecondaryClick;

  memory.prevJump = jump;
  memory.prevDash = dash;
  memory.prevUseItem = useItem;
  memory.prevPause = pause;
  memory.prevZoomCycle = zoomCycle;
  memory.prevPrimaryClick = primaryClick;
  memory.prevSecondaryClick = secondaryClick;

  // Right stick vertical axis controls smooth zoom in/out (push up = negative axis = zoom in)
  const zoomDelta = Math.abs(rawRightY) > 0.32 ? -rawRightY : 0;

  const moveX =
    Math.abs(rawX) > deadzone
      ? rawX
      : dpadLeft
      ? -1
      : dpadRight
      ? 1
      : 0;
  const moveY =
    Math.abs(rawY) > deadzone
      ? rawY
      : dpadUp
      ? -1
      : dpadDown
      ? 1
      : 0;

  return {
    connected: true,
    controllerName: activePad.id || 'Gamepad',
    left,
    right,
    up,
    down,
    jump,
    jumpJustPressed,
    dashJustPressed,
    useItemJustPressed,
    pauseJustPressed,
    zoomCycleJustPressed,
    zoomDelta,
    moveX,
    moveY,
    primaryActionJustPressed,
    secondaryActionJustPressed,
  };
}

/**
 * Safely reads navigator.getGamepads() in browser environments.
 */
export function pollBrowserGamepads(memory: GamepadMemoryState): PolledGamepadInput {
  if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') {
    return extractGamepadInput([], memory);
  }
  try {
    const rawPads = navigator.getGamepads();
    const list: Array<GamepadLike | null> = [];
    if (rawPads) {
      for (let i = 0; i < rawPads.length; i++) {
        list.push(rawPads[i]);
      }
    }
    return extractGamepadInput(list, memory);
  } catch {
    return extractGamepadInput([], memory);
  }
}
