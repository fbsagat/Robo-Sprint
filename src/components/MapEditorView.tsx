import React, { useCallback, useEffect, useRef, useState } from 'react';
import { soundEngine } from '../game/audio';
import {
  ALL_ITEM_TYPES,
  BIOME_CONFIGS,
  FIXED_DT,
  ITEM_METADATA,
  ROBOT_PALETTES,
} from '../game/constants';
import {
  countEditorStageObjects,
  createBlankEditorStage,
  createTemplateEditorStage,
  EDITOR_COURSE_TIME_LIMIT,
  eraseEditorItemAt,
  placeEditorItem,
  snapCoord,
  type EditorToolCategory,
  type EditorToolSpec,
} from '../game/editor';
import {
  applyWheelZoom,
  clampCameraZoom,
  createGamepadMemoryState,
  cycleCameraZoomLevel,
  pollBrowserGamepads,
  stepCameraZoomLevel,
} from '../game/gamepad';
import { createRobotState, stepSimulation, updateStageDynamics } from '../game/physics';
import { GameRenderer } from '../game/renderer';
import type {
  BiomeId,
  EditorModeState,
  GameEvent,
  ItemType,
  MatchState,
  PlayerInput,
  RobotClassId,
  StageData,
} from '../game/types';
import { ItemIconSvg, RobotAvatarSvg } from './Icons';

interface MapEditorViewProps {
  playerId: string;
  playerName: string;
  colorIndex: number;
  robotClass: RobotClassId;
  editorState: EditorModeState;
  onUpdateStatus: (
    validated: boolean,
    objectCount: number,
    creatorBestTime: number | null
  ) => void;
  onSubmitMap: (
    stage: StageData,
    creatorBestTime: number,
    courseTimeLimit: number,
    title: string
  ) => void;
  onLeaveRoom: () => void;
}

export function MapEditorView({
  playerId,
  playerName,
  colorIndex,
  robotClass,
  editorState,
  onUpdateStatus,
  onSubmitMap,
  onLeaveRoom,
}: MapEditorViewProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const minimapRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<GameRenderer>(new GameRenderer());

  const [stage, setStage] = useState<StageData>(() =>
    createBlankEditorStage(1, 'foundry', Date.now() % 100000)
  );
  const stageRef = useRef<StageData>(stage);
  stageRef.current = stage;

  const [mapTitle, setMapTitle] = useState<string>(`Pista de ${playerName}`);
  const [subMode, setSubMode] = useState<'build' | 'test'>('build');
  const subModeRef = useRef<'build' | 'test'>('build');
  subModeRef.current = subMode;

  const [activeCategory, setActiveCategory] = useState<EditorToolCategory>('platforms');
  const [selectedTool, setSelectedTool] = useState<EditorToolSpec>({
    kind: 'platform',
    platformKind: 'solid',
    width: 190,
  });
  const selectedToolRef = useRef<EditorToolSpec>(selectedTool);
  selectedToolRef.current = selectedTool;

  const [snapEnabled, setSnapEnabled] = useState(true);
  const snapRef = useRef(true);
  snapRef.current = snapEnabled;

  // Creator validation state: ONLY valid if the creator finishes their own course in playtest!
  const [isValidated, setIsValidated] = useState(false);
  const [creatorBestTime, setCreatorBestTime] = useState<number | null>(null);
  const [validatedSnapshot, setValidatedSnapshot] = useState<StageData | null>(null);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [statusBanner, setStatusBanner] = useState<string | null>(
    'Construa sua pista livremente e clique em "Testar & Validar Mapa" para provar que ela é possível!'
  );

  // Playtest telemetry state
  const [testTimeLeft, setTestTimeLeft] = useState<number>(EDITOR_COURSE_TIME_LIMIT);
  const [testElapsed, setTestElapsed] = useState<number>(0);
  const [testHeldItem, setTestHeldItem] = useState<ItemType | null>(null);
  const [testProgress, setTestProgress] = useState<number>(0);
  const [testFailedReason, setTestFailedReason] = useState<string | null>(null);

  // Editor free-camera state
  const camRef = useRef<{ x: number; y: number; zoom: number }>({
    x: 380,
    y: -60,
    zoom: 1.15,
  });
  const [editorZoom, setEditorZoom] = useState(1.15);
  const gamepadMemRef = useRef(createGamepadMemoryState());

  const applyEditorZoom = useCallback((nextZoom: number) => {
    const clamped = clampCameraZoom(nextZoom);
    camRef.current.zoom = clamped;
    rendererRef.current.setZoom(clamped);
    setEditorZoom(clamped);
  }, []);

  // Mouse cursor screen & world coords for live ghost placement preview, panning, and continuous erasing
  const pointerRef = useRef<{
    screenX: number;
    screenY: number;
    worldX: number;
    worldY: number;
    inside: boolean;
    panning: boolean;
    erasing: boolean;
    panStartX: number;
    panStartY: number;
    camStartX: number;
    camStartY: number;
  }>({
    screenX: 0,
    screenY: 0,
    worldX: 380,
    worldY: -60,
    inside: false,
    panning: false,
    erasing: false,
    panStartX: 0,
    panStartY: 0,
    camStartX: 0,
    camStartY: 0,
  });

  // Playtest simulation instance
  const testMatchRef = useRef<MatchState | null>(null);
  const testKeysRef = useRef<Set<string>>(new Set());
  const testInputLatchRef = useRef({
    prevJump: false,
    jumpJustPressed: false,
    dashJustPressed: false,
    useItem: false,
  });

  // Stable refs for callbacks & props so the 60fps Canvas loop never restarts or flickers
  const onUpdateStatusRef = useRef(onUpdateStatus);
  onUpdateStatusRef.current = onUpdateStatus;

  const isSubmittedRef = useRef(isSubmitted);
  isSubmittedRef.current = isSubmitted;
  const isValidatedRef = useRef(isValidated);
  isValidatedRef.current = isValidated;
  const creatorBestTimeRef = useRef(creatorBestTime);
  creatorBestTimeRef.current = creatorBestTime;
  const courseTimeLimitRef = useRef(editorState.courseTimeLimit || EDITOR_COURSE_TIME_LIMIT);
  courseTimeLimitRef.current = editorState.courseTimeLimit || EDITOR_COURSE_TIME_LIMIT;
  const playerProfileRef = useRef({
    playerId,
    playerName,
    colorIndex,
    robotClass,
  });
  playerProfileRef.current = { playerId, playerName, colorIndex, robotClass };

  // Notify server of current object count and validation status
  const syncStatusToServer = useCallback(
    (nextStage: StageData, nextVal: boolean, bestTime: number | null) => {
      onUpdateStatusRef.current(nextVal, countEditorStageObjects(nextStage), bestTime);
    },
    []
  );

  const applyStageEdit = useCallback(
    (nextStage: StageData, message?: string) => {
      if (isSubmittedRef.current) return;
      stageRef.current = nextStage;
      setStage(nextStage);
      if (isValidatedRef.current) {
        isValidatedRef.current = false;
        setIsValidated(false);
        setStatusBanner(
          'Mapa modificado! Clique em "Testar & Validar Mapa" para validar as novas alterações.'
        );
        syncStatusToServer(nextStage, false, creatorBestTimeRef.current);
      } else {
        if (message) setStatusBanner(message);
        syncStatusToServer(nextStage, false, creatorBestTimeRef.current);
      }
    },
    [syncStatusToServer]
  );

  // Start Creator Playtest
  const handleStartPlaytest = useCallback(() => {
    if (isSubmittedRef.current) return;
    const clonedStage = structuredClone(stageRef.current);
    for (const p of clonedStage.platforms) {
      p.x = p.baseX;
      p.y = p.baseY;
      if (p.kind === 'crumbling') {
        p.crumbleState = 'intact';
        p.crumbleTimer = 0;
      }
    }
    for (const box of clonedStage.itemBoxes) box.respawnAt = 0;
    for (const c of clonedStage.crystals) c.respawnAt = 0;

    const prof = playerProfileRef.current;
    const creatorRobot = createRobotState({
      id: prof.playerId || 'creator_local',
      name: prof.playerName,
      colorIndex: prof.colorIndex,
      robotClass: prof.robotClass,
      isBot: false,
      stage: clonedStage,
      spawnSlot: 0,
    });

    testMatchRef.current = {
      roomCode: 'EDITOR_TEST',
      gameMode: 'editor',
      stageNumber: 1,
      phase: 'racing',
      countdownTimer: 0,
      raceTime: 0,
      stage: clonedStage,
      robots: [creatorRobot],
      projectiles: [],
      traps: [],
      events: [],
      nextEntityId: 5000,
      podiumAutoTimer: 0,
    };

    testKeysRef.current.clear();
    testInputLatchRef.current = {
      prevJump: false,
      jumpJustPressed: false,
      dashJustPressed: false,
      useItem: false,
    };

    rendererRef.current.setZoom(1.35);
    rendererRef.current.resetCamera(clonedStage.startX, clonedStage.startY - 24);
    setTestFailedReason(null);
    setTestTimeLeft(courseTimeLimitRef.current);
    setTestElapsed(0);
    setTestHeldItem(null);
    setTestProgress(0);
    setSubMode('test');
    subModeRef.current = 'test';
    setStatusBanner(
      'TESTE DO CRIADOR: Alcance o Portal de Chegada antes do tempo do percurso acabar para validar seu mapa!'
    );
  }, []);

  const handleStopPlaytest = useCallback(() => {
    setSubMode('build');
    subModeRef.current = 'build';
    testMatchRef.current = null;
    rendererRef.current.setCameraDirectly(
      camRef.current.x,
      camRef.current.y,
      camRef.current.zoom
    );
  }, []);

  const handleConfirmAndSubmit = useCallback(() => {
    const stageToSubmit = isValidated
      ? stageRef.current
      : validatedSnapshot;
    if (!stageToSubmit) {
      setStatusBanner(
        'Você precisa concluir seu próprio mapa no modo Teste para provar que ele é válido!'
      );
      handleStartPlaytest();
      return;
    }
    setIsSubmitted(true);
    isSubmittedRef.current = true;
    setSubMode('build');
    subModeRef.current = 'build';
    setStatusBanner('Mapa Validado e Confirmado! Aguardando demais criadores para iniciar a batalha...');
    onSubmitMap(
      stageToSubmit,
      creatorBestTime ?? 10.0,
      editorState.courseTimeLimit || EDITOR_COURSE_TIME_LIMIT,
      mapTitle
    );
  }, [
    creatorBestTime,
    editorState.courseTimeLimit,
    handleStartPlaytest,
    isValidated,
    mapTitle,
    onSubmitMap,
    validatedSnapshot,
  ]);

  // If the server build timer gets down to <= 1.2s and we have a validated snapshot, auto-submit it!
  useEffect(() => {
    if (
      !isSubmitted &&
      editorState.buildTimeRemaining <= 1.2 &&
      (isValidated || validatedSnapshot)
    ) {
      handleConfirmAndSubmit();
    }
  }, [
    editorState.buildTimeRemaining,
    handleConfirmAndSubmit,
    isSubmitted,
    isValidated,
    validatedSnapshot,
  ]);

  // Keyboard shortcuts for Build Pan & Playtest Controls
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return;
      }

      if (e.code === 'KeyT') {
        e.preventDefault();
        if (subModeRef.current === 'build') {
          handleStartPlaytest();
        } else {
          handleStopPlaytest();
        }
        return;
      }

      if (e.code === 'KeyR' && subModeRef.current === 'test') {
        e.preventDefault();
        handleStartPlaytest();
        return;
      }

      if (
        e.code === 'Space' ||
        e.code === 'ArrowUp' ||
        e.code === 'ArrowDown' ||
        e.code === 'ArrowLeft' ||
        e.code === 'ArrowRight'
      ) {
        e.preventDefault();
      }

      const wasDown = testKeysRef.current.has(e.code);
      testKeysRef.current.add(e.code);

      if (!wasDown && subModeRef.current === 'test') {
        if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') {
          testInputLatchRef.current.jumpJustPressed = true;
        }
        if (e.code === 'ShiftLeft' || e.code === 'ShiftRight' || e.code === 'KeyK') {
          testInputLatchRef.current.dashJustPressed = true;
        }
        if (e.code === 'KeyE' || e.code === 'KeyF') {
          testInputLatchRef.current.useItem = true;
        }
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      testKeysRef.current.delete(e.code);
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [handleStartPlaytest, handleStopPlaytest]);

  // Playtest Audio Events helper
  const playEventsAudio = useCallback((events: GameEvent[]) => {
    for (const ev of events) {
      if (ev.type === 'jump') soundEngine.playJump();
      else if (ev.type === 'dash') soundEngine.playDash();
      else if (ev.type === 'spring') soundEngine.playSpring();
      else if (ev.type === 'pickup') soundEngine.playPickup();
      else if (ev.type === 'turbo') soundEngine.playTurbo();
      else if (ev.type === 'jetpack') soundEngine.playJetpack();
      else if (ev.type === 'shield') soundEngine.playShield();
      else if (ev.type === 'whirlwind_drop' || ev.type === 'whirlwind_hit')
        soundEngine.playWhirlwind();
      else if (ev.type === 'barrier_drop' || ev.type === 'barrier_hit')
        soundEngine.playBarrier();
      else if (ev.type === 'grease_drop' || ev.type === 'grease_hit')
        soundEngine.playGrease();
      else if (ev.type === 'checkpoint') soundEngine.playCheckpoint();
      else if (ev.type === 'crystal') soundEngine.playCrystal();
      else if (ev.type === 'hurt' || ev.type === 'fall_reset') soundEngine.playHurt();
      else if (ev.type === 'finish') soundEngine.playFinish();
    }
  }, []);

  // Main 60fps Render & Playtest Physics Loop (isolated from React re-renders so it never flickers!)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let viewW = canvas.clientWidth || window.innerWidth;
    let viewH = canvas.clientHeight || window.innerHeight;

    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      viewW = canvas.clientWidth || window.innerWidth;
      viewH = canvas.clientHeight || window.innerHeight;
      const targetW = Math.round(viewW * dpr);
      const targetH = Math.round(viewH * dpr);
      if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW;
        canvas.height = targetH;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    let rafId = 0;
    let lastTime = performance.now();
    let accum = 0;
    let hudTick = 0;

    const frame = (now: number) => {
      const rawDt = Math.min(0.05, Math.max(0.001, (now - lastTime) / 1000));
      lastTime = now;
      const nowSec = now / 1000;

      // Poll connected gamepads at 60fps for both Build and Playtest sub-modes
      const gp = pollBrowserGamepads(gamepadMemRef.current);
      if (gp.connected) {
        if (gp.zoomCycleJustPressed) {
          applyEditorZoom(cycleCameraZoomLevel(camRef.current.zoom));
        } else if (gp.zoomDelta !== 0) {
          applyEditorZoom(camRef.current.zoom + gp.zoomDelta * 1.25 * rawDt);
        }
        if (gp.pauseJustPressed) {
          if (subModeRef.current === 'build') {
            handleStartPlaytest();
          } else {
            handleStopPlaytest();
          }
        }
      }

      if (subModeRef.current === 'build') {
        // Keyboard + Gamepad camera panning in Build Mode (WASD / Arrow keys / Left Stick / D-Pad)
        const keys = testKeysRef.current;
        const panSpeed = 520 / camRef.current.zoom;
        if (keys.has('KeyA') || keys.has('ArrowLeft') || gp.left) {
          camRef.current.x -= panSpeed * rawDt;
        }
        if (keys.has('KeyD') || keys.has('ArrowRight') || gp.right) {
          camRef.current.x += panSpeed * rawDt;
        }
        if (keys.has('KeyW') || keys.has('ArrowUp') || (gp.connected && gp.jump)) {
          camRef.current.y -= panSpeed * rawDt;
        }
        if (keys.has('KeyS') || keys.has('ArrowDown') || gp.down) {
          camRef.current.y += panSpeed * rawDt;
        }

        if (gp.connected && gp.primaryActionJustPressed) {
          const next = placeEditorItem(
            stageRef.current,
            selectedToolRef.current,
            camRef.current.x,
            camRef.current.y,
            snapRef.current
          );
          soundEngine.playPickup();
          applyStageEdit(next);
        } else if (gp.connected && gp.secondaryActionJustPressed) {
          const res = eraseEditorItemAt(stageRef.current, camRef.current.x, camRef.current.y);
          if (res.removed) {
            soundEngine.playPickup();
            applyStageEdit(res.stage, 'Objeto removido da pista.');
          }
        }

        const st = stageRef.current;
        updateStageDynamics(st, nowSec);
        rendererRef.current.setCameraDirectly(
          camRef.current.x,
          camRef.current.y,
          camRef.current.zoom
        );

        // Keep cursor world coordinates 100% locked to screen pointer even during camera pan/zoom
        if (pointerRef.current.inside) {
          pointerRef.current.worldX =
            (pointerRef.current.screenX - viewW * 0.5) / camRef.current.zoom +
            camRef.current.x;
          pointerRef.current.worldY =
            (pointerRef.current.screenY - viewH * 0.54) / camRef.current.zoom +
            camRef.current.y;
        }

        // Render stage with a preview robot standing at Start
        const prof = playerProfileRef.current;
        const previewRobot = createRobotState({
          id: prof.playerId || 'preview',
          name: prof.playerName,
          colorIndex: prof.colorIndex,
          robotClass: prof.robotClass,
          isBot: false,
          stage: st,
          spawnSlot: 0,
        });

        rendererRef.current.renderWorld(
          ctx,
          viewW,
          viewH,
          rawDt,
          nowSec,
          st,
          [previewRobot],
          [],
          [],
          '__editor_free_cam__' // prevents renderWorld from overriding our free camera!
        );

        // Draw subtle Editor Grid & Tool Ghost Preview in world space
        drawEditorOverlay(
          ctx,
          viewW,
          viewH,
          camRef.current,
          pointerRef.current,
          selectedToolRef.current,
          snapRef.current
        );
      } else if (subModeRef.current === 'test' && testMatchRef.current) {
        const match = testMatchRef.current;
        const courseLimit = courseTimeLimitRef.current;

        if (gp.connected) {
          if (gp.jumpJustPressed) testInputLatchRef.current.jumpJustPressed = true;
          if (gp.dashJustPressed) testInputLatchRef.current.dashJustPressed = true;
          if (gp.useItemJustPressed) testInputLatchRef.current.useItem = true;
        }

        accum += rawDt;
        while (accum >= FIXED_DT) {
          accum -= FIXED_DT;
          const robot = match.robots[0];
          if (robot && !robot.finished && match.raceTime < courseLimit) {
            const keys = testKeysRef.current;
            const left = keys.has('ArrowLeft') || keys.has('KeyA') || gp.left;
            const right = keys.has('ArrowRight') || keys.has('KeyD') || gp.right;
            const down = keys.has('ArrowDown') || keys.has('KeyS') || gp.down;
            const jump =
              keys.has('Space') || keys.has('ArrowUp') || keys.has('KeyW') || gp.jump;
            const latch = testInputLatchRef.current;
            const jumpJustPressed = latch.jumpJustPressed || (jump && !latch.prevJump);
            latch.prevJump = jump;

            const inputMap = new Map<string, PlayerInput>([
              [
                robot.id,
                {
                  left,
                  right,
                  down,
                  jump,
                  jumpJustPressed,
                  dashJustPressed: latch.dashJustPressed,
                  useItem: latch.useItem,
                },
              ],
            ]);
            latch.jumpJustPressed = false;
            latch.dashJustPressed = false;
            latch.useItem = false;

            stepSimulation(match, inputMap, FIXED_DT);

            if (match.events.length > 0) {
              const fresh = rendererRef.current.ingestEvents(match.events, robot.id);
              playEventsAudio(fresh);
              match.events = [];
            }

            // Check if creator finished the course!
            if (robot.finished) {
              const finishTime = robot.finishTime ?? Number(match.raceTime.toFixed(2));
              isValidatedRef.current = true;
              setIsValidated(true);
              setValidatedSnapshot(structuredClone(stageRef.current));
              setCreatorBestTime((prev) =>
                prev === null ? finishTime : Math.min(prev, finishTime)
              );
              setStatusBanner(
                `MAPA VALIDADO COM SUCESSO em ${finishTime.toFixed(2)}s! Clique em "Confirmar & Enviar Mapa" para entrar na batalha!`
              );
              syncStatusToServer(stageRef.current, true, finishTime);
            } else if (match.raceTime >= courseLimit) {
              setTestFailedReason(
                `Tempo limite do percurso (${courseLimit}s) esgotado! Ajuste o mapa ou tente novamente.`
              );
            }
          }
        }

        const robot = match.robots[0];
        rendererRef.current.renderWorld(
          ctx,
          viewW,
          viewH,
          rawDt,
          match.raceTime,
          match.stage,
          match.robots,
          match.projectiles,
          match.traps,
          robot?.id ?? ''
        );

        hudTick++;
        if (hudTick % 4 === 0 && robot) {
          setTestElapsed(Number(match.raceTime.toFixed(1)));
          setTestTimeLeft(Math.max(0, Number((courseLimit - match.raceTime).toFixed(1))));
          setTestHeldItem(robot.heldItem);
          setTestProgress(robot.progress);
        }
      }

      // Draw Live 2D Minimap in bottom-right corner
      if (minimapRef.current) {
        drawEditorMinimap(
          minimapRef.current,
          stageRef.current,
          subModeRef.current === 'test' && testMatchRef.current
            ? rendererRef.current.getCameraPosition()
            : camRef.current,
          subModeRef.current === 'test' && testMatchRef.current
            ? testMatchRef.current.robots[0]
            : null
        );
      }

      rafId = requestAnimationFrame(frame);
    };

    rafId = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(rafId);
      ro.disconnect();
    };
  }, [
    applyEditorZoom,
    applyStageEdit,
    handleStartPlaytest,
    handleStopPlaytest,
    playEventsAudio,
    syncStatusToServer,
  ]);

  const computeWorldFromScreen = (
    sx: number,
    sy: number,
    viewW: number,
    viewH: number
  ): { x: number; y: number } => ({
    x: (sx - viewW * 0.5) / camRef.current.zoom + camRef.current.x,
    y: (sy - viewH * 0.54) / camRef.current.zoom + camRef.current.y,
  });

  const eraseAtWorldCoords = (worldX: number, worldY: number) => {
    const res = eraseEditorItemAt(stageRef.current, worldX, worldY);
    if (res.removed) {
      soundEngine.playPickup();
      applyStageEdit(res.stage, 'Objeto(s) removido(s) da pista.');
    }
  };

  // Canvas pointer handlers in Build Mode
  const handleCanvasPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    pointerRef.current.screenX = sx;
    pointerRef.current.screenY = sy;
    pointerRef.current.inside = true;

    if (subMode !== 'build') return;

    // Middle click (button === 1 or buttons & 4), Shift+Click, or Space held => hold & drag camera
    if (
      e.button === 1 ||
      (e.buttons & 4) !== 0 ||
      e.shiftKey ||
      testKeysRef.current.has('Space')
    ) {
      e.preventDefault();
      pointerRef.current.panning = true;
      pointerRef.current.erasing = false;
      pointerRef.current.panStartX = e.clientX;
      pointerRef.current.panStartY = e.clientY;
      pointerRef.current.camStartX = camRef.current.x;
      pointerRef.current.camStartY = camRef.current.y;
      canvas.style.cursor = 'grabbing';
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {
        // Ignore synthetic events without active pointerId
      }
      return;
    }

    const world = computeWorldFromScreen(sx, sy, rect.width, rect.height);
    pointerRef.current.worldX = world.x;
    pointerRef.current.worldY = world.y;

    // Right click OR Left click with Eraser tool => start continuous hold-to-erase
    if (
      e.button === 2 ||
      (e.button === 0 && selectedToolRef.current.kind === 'eraser')
    ) {
      e.preventDefault();
      pointerRef.current.erasing = true;
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {
        // Ignore synthetic events without active pointerId
      }
      eraseAtWorldCoords(world.x, world.y);
      return;
    }

    // Left click => apply selected tool
    if (e.button === 0) {
      const next = placeEditorItem(
        stageRef.current,
        selectedToolRef.current,
        world.x,
        world.y,
        snapRef.current
      );
      soundEngine.playPickup();
      applyStageEdit(next);
    }
  };

  const handleCanvasPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    pointerRef.current.screenX = sx;
    pointerRef.current.screenY = sy;
    pointerRef.current.inside = true;

    if (pointerRef.current.panning) {
      const dx = (e.clientX - pointerRef.current.panStartX) / camRef.current.zoom;
      const dy = (e.clientY - pointerRef.current.panStartY) / camRef.current.zoom;
      camRef.current.x = pointerRef.current.camStartX - dx;
      camRef.current.y = pointerRef.current.camStartY - dy;
      rendererRef.current.setCameraDirectly(
        camRef.current.x,
        camRef.current.y,
        camRef.current.zoom
      );
      const world = computeWorldFromScreen(sx, sy, rect.width, rect.height);
      pointerRef.current.worldX = world.x;
      pointerRef.current.worldY = world.y;
      return;
    }

    const world = computeWorldFromScreen(sx, sy, rect.width, rect.height);
    pointerRef.current.worldX = world.x;
    pointerRef.current.worldY = world.y;

    // Continuous erasing while holding mouse click (Eraser tool left-drag or right-drag)
    if (
      subMode === 'build' &&
      (pointerRef.current.erasing ||
        (e.buttons & 2) !== 0 ||
        ((e.buttons & 1) !== 0 && selectedToolRef.current.kind === 'eraser'))
    ) {
      eraseAtWorldCoords(world.x, world.y);
    }
  };

  const handleCanvasPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (pointerRef.current.panning || pointerRef.current.erasing) {
      pointerRef.current.panning = false;
      pointerRef.current.erasing = false;
      if (canvas) {
        canvas.style.cursor = '';
        try {
          canvas.releasePointerCapture(e.pointerId);
        } catch {
          // Ignore if not captured
        }
      }
    }
  };

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    const nextZoom = applyWheelZoom(camRef.current.zoom, e.deltaY);
    applyEditorZoom(nextZoom);
  };

  const buildSecs = Math.max(0, Math.ceil(editorState.buildTimeRemaining));
  const buildMM = String(Math.floor(buildSecs / 60)).padStart(2, '0');
  const buildSS = String(buildSecs % 60).padStart(2, '0');
  const readyCount = editorState.creators.filter((c) => c.submitted).length;
  const totalCreators = editorState.creators.length;
  const totalObjects = countEditorStageObjects(stage);

  const buildLimit = editorState.buildTimeLimit || 120;
  const buildPct = Math.max(0, Math.min(100, (editorState.buildTimeRemaining / buildLimit) * 100));
  const readyPct = totalCreators > 0 ? Math.round((readyCount / totalCreators) * 100) : 0;

  return (
    <div className="fixed inset-0 z-20 select-none overflow-hidden bg-[#0F1724]">
      {/* Interactive Editor / Playtest Canvas */}
      <canvas
        ref={canvasRef}
        data-testid="editor-canvas"
        onContextMenu={(e) => e.preventDefault()}
        onAuxClick={(e) => {
          if (e.button === 1) e.preventDefault();
        }}
        onPointerDown={handleCanvasPointerDown}
        onPointerMove={handleCanvasPointerMove}
        onPointerUp={handleCanvasPointerUp}
        onPointerCancel={handleCanvasPointerUp}
        onPointerLeave={() => {
          pointerRef.current.inside = false;
        }}
        onWheel={handleWheel}
        className={`block w-full h-full ${
          subMode === 'build' ? 'cursor-crosshair' : 'cursor-default'
        }`}
      />

      {/* TOP COMMAND BAR + GUIDANCE BANNER */}
      <div className="fixed top-3 inset-x-3 z-30 flex flex-col items-center gap-2 pointer-events-none">
        <div className="w-full flex flex-wrap items-center justify-between gap-3 bg-[#0B1120]/95 backdrop-blur-md border border-slate-700/90 rounded-2xl px-4 py-2.5 shadow-[0_14px_38px_rgba(0,0,0,0.65)] pointer-events-auto">
          {/* Left Cluster: Mode Badge + Map Title + Live Dimensions */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-gradient-to-r from-amber-500/20 to-amber-500/10 border border-amber-400/60 text-amber-300 text-xs font-display font-bold tracking-wider whitespace-nowrap shadow-inner">
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
              MODO EDITOR
            </div>

            <div className="flex items-center bg-slate-900/95 border border-slate-700/90 rounded-xl px-2.5 py-1 focus-within:border-amber-400/80 transition-colors">
              <span className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold mr-2 hidden sm:inline">
                Mapa
              </span>
              <input
                type="text"
                maxLength={26}
                disabled={isSubmitted}
                value={mapTitle}
                onChange={(e) => setMapTitle(e.target.value)}
                aria-label="Nome do seu mapa"
                className="bg-transparent text-xs font-bold text-white focus:outline-none w-36 sm:w-44"
              />
            </div>

            <div className="hidden xl:flex items-center gap-2 bg-slate-900/85 border border-slate-800 rounded-xl px-3 py-1.5 text-[11px] font-mono-num">
              <span className="text-amber-300 font-bold">{totalObjects} obj</span>
              <span className="text-slate-600">·</span>
              <span className="text-slate-300">
                {Math.round(stage.horizontalSpan / 10)}m × {Math.round(stage.targetClimb / 10)}m
              </span>
              <span className="text-slate-600">·</span>
              <span className="text-sky-300 font-semibold">
                {BIOME_CONFIGS[stage.biome].name}
              </span>
            </div>
          </div>

          {/* Center Cluster: Build Timer, Course Limit & Validation Status */}
          <div className="flex items-center gap-2.5">
            {/* Build Time Remaining with mini progress bar */}
            <div className="bg-slate-900/95 border border-slate-700/85 rounded-xl px-3 py-1 flex flex-col justify-center min-w-[104px]">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">
                  Edição
                </span>
                <span
                  className={`font-mono-num text-sm font-bold ${
                    buildSecs <= 20 ? 'text-red-400' : 'text-amber-300'
                  }`}
                >
                  {buildMM}:{buildSS}
                </span>
              </div>
              <div className="w-full h-1 bg-slate-800 rounded-full overflow-hidden mt-0.5">
                <div
                  className={`h-full transition-all duration-300 ${
                    buildSecs <= 20 ? 'bg-red-500' : 'bg-amber-400'
                  }`}
                  style={{ width: `${buildPct}%` }}
                />
              </div>
            </div>

            {/* Course Time Limit */}
            <div className="bg-slate-900/95 border border-slate-700/85 rounded-xl px-3 py-1.5 flex items-center gap-2">
              <span className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">
                Percurso
              </span>
              <span className="font-mono-num text-sm font-bold text-sky-300">
                {subMode === 'test'
                  ? `${testTimeLeft.toFixed(1)}s`
                  : `${editorState.courseTimeLimit || EDITOR_COURSE_TIME_LIMIT}s`}
              </span>
            </div>

            {/* Creator Validation Status Badge */}
            <div
              data-testid="editor-validation-badge"
              className={`px-3 py-1.5 rounded-xl border text-xs font-bold flex items-center gap-2 whitespace-nowrap shadow-sm ${
                isValidated
                  ? 'bg-emerald-950/90 border-emerald-500/75 text-emerald-300'
                  : 'bg-amber-950/85 border-amber-500/65 text-amber-200'
              }`}
            >
              <span
                className={`w-2.5 h-2.5 rounded-full ${
                  isValidated
                    ? 'bg-emerald-400 shadow-[0_0_8px_#34d399]'
                    : 'bg-amber-400'
                }`}
              />
              {isValidated
                ? `MAPA VALIDADO (${creatorBestTime?.toFixed(1)}s)`
                : 'NÃO VALIDADO'}
            </div>
          </div>

          {/* Right Cluster: Playtest, Submit & Leave Actions */}
          <div className="flex items-center gap-2">
            {subMode === 'build' ? (
              <button
                type="button"
                disabled={isSubmitted}
                onClick={handleStartPlaytest}
                className="bg-sky-500 hover:bg-sky-400 disabled:opacity-45 text-slate-950 font-display font-bold text-xs px-3.5 py-2 rounded-xl transition-all cursor-pointer whitespace-nowrap shadow-md"
              >
                Testar & Validar Mapa (T)
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={handleStartPlaytest}
                  className="bg-slate-800 hover:bg-slate-700 border border-slate-600 text-slate-100 font-semibold text-xs px-3 py-2 rounded-xl transition-colors cursor-pointer whitespace-nowrap"
                >
                  Reiniciar (R)
                </button>
                <button
                  type="button"
                  onClick={handleStopPlaytest}
                  className="bg-amber-500 hover:bg-amber-400 text-slate-950 font-display font-bold text-xs px-3.5 py-2 rounded-xl transition-colors cursor-pointer whitespace-nowrap shadow-md"
                >
                  Voltar a Editar (T)
                </button>
              </>
            )}

            <button
              type="button"
              data-testid="confirm-submit-map-btn"
              disabled={isSubmitted || (!isValidated && !validatedSnapshot)}
              onClick={handleConfirmAndSubmit}
              title={
                isValidated || validatedSnapshot
                  ? 'Confirmar seu mapa validado para a batalha multiplayer'
                  : 'Conclua o percurso no Teste de Validação para liberar o envio'
              }
              className={`font-display font-bold text-xs px-4 py-2 rounded-xl transition-all cursor-pointer whitespace-nowrap ${
                isSubmitted
                  ? 'bg-emerald-800/70 border border-emerald-500/60 text-emerald-200 cursor-default'
                  : isValidated || validatedSnapshot
                  ? 'bg-emerald-500 hover:bg-emerald-400 text-slate-950 shadow-lg'
                  : 'bg-slate-800/85 border border-slate-700 text-slate-400 opacity-75'
              }`}
            >
              {isSubmitted
                ? `Pronto (${readyCount}/${totalCreators})`
                : 'Confirmar & Enviar Mapa'}
            </button>

            <button
              type="button"
              onClick={onLeaveRoom}
              className="bg-slate-900 hover:bg-red-950/85 border border-slate-700 hover:border-red-500/60 text-slate-300 hover:text-white text-xs font-semibold px-3 py-2 rounded-xl transition-colors cursor-pointer"
            >
              Sair
            </button>
          </div>
        </div>

        {/* STATUS / GUIDANCE BANNER */}
        {statusBanner && (
          <div className="max-w-3xl bg-[#0B1120]/94 backdrop-blur-md border border-slate-700/85 text-slate-100 text-xs font-medium px-4 py-1.5 rounded-xl shadow-xl flex items-center gap-3 pointer-events-auto">
            <span className="w-2 h-2 rounded-full bg-sky-400 shrink-0" />
            <span>{statusBanner}</span>
            {subMode === 'test' && (
              <span className="font-mono-num text-amber-300 font-bold shrink-0 pl-2 border-l border-slate-700">
                Progresso: {testProgress}% · Tempo: {testElapsed.toFixed(1)}s
              </span>
            )}
          </div>
        )}
      </div>

      {/* COURSE TIMEOUT ALERT IN PLAYTEST */}
      {subMode === 'test' && testFailedReason && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/75 p-4 pointer-events-auto">
          <div className="max-w-md w-full bg-[#0F172A] border border-red-500/70 rounded-2xl p-6 text-center shadow-2xl">
            <div className="text-xs font-bold uppercase tracking-wider text-red-400">
              Tempo do Percurso Esgotado
            </div>
            <h3 className="font-display text-xl font-bold text-white mt-1">
              Percurso Não Concluído a Tempo
            </h3>
            <p className="text-xs text-slate-300 mt-2">{testFailedReason}</p>
            <div className="mt-5 flex gap-2.5 justify-center">
              <button
                type="button"
                onClick={handleStartPlaytest}
                className="bg-sky-500 hover:bg-sky-400 text-slate-950 font-display font-bold text-xs px-4 py-2.5 rounded-xl cursor-pointer"
              >
                Tentar Novamente (R)
              </button>
              <button
                type="button"
                onClick={handleStopPlaytest}
                className="bg-amber-500 hover:bg-amber-400 text-slate-950 font-display font-bold text-xs px-4 py-2.5 rounded-xl cursor-pointer"
              >
                Ajustar Mapa no Editor (T)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* PLAYTEST ITEM & DASH HUD (WHEN IN TEST SUBMODE) */}
      {subMode === 'test' && (
        <div className="fixed bottom-4 left-4 z-30 flex items-center gap-3 pointer-events-auto">
          <button
            type="button"
            disabled={!testHeldItem}
            onClick={() => {
              testInputLatchRef.current.useItem = true;
            }}
            className={`flex items-center gap-2.5 rounded-xl px-3.5 py-2.5 border shadow-lg ${
              testHeldItem
                ? 'bg-[#0F172A]/94 border-amber-400/80 text-white cursor-pointer'
                : 'bg-[#0F172A]/85 border-slate-800 text-slate-500'
            }`}
          >
            <div className="w-9 h-9 rounded-lg bg-slate-900 border border-slate-700 flex items-center justify-center">
              {testHeldItem ? (
                <ItemIconSvg type={testHeldItem} size={22} />
              ) : (
                <span className="font-mono-num text-sm">?</span>
              )}
            </div>
            <div className="text-left">
              <div className="text-xs font-bold">
                {testHeldItem ? ITEM_METADATA[testHeldItem].name : 'Sem item'}
              </div>
              <div className="text-[10px] text-slate-400">
                {testHeldItem ? 'Tecla E para usar' : 'Colete caixas no teste'}
              </div>
            </div>
          </button>

          <button
            type="button"
            onClick={() => {
              testInputLatchRef.current.dashJustPressed = true;
            }}
            className="bg-[#0F172A]/94 border border-sky-400/70 text-white rounded-xl px-3.5 py-2.5 text-xs font-bold cursor-pointer shadow-lg"
          >
            Dash (Shift)
          </button>
        </div>
      )}

      {/* BUILD MODE TOOLBOX PALETTE (BOTTOM-LEFT WORKSTATION DOCK) */}
      {subMode === 'build' && !isSubmitted && (
        <div
          data-testid="editor-toolbox"
          className="fixed bottom-3 left-3 z-30 max-w-3xl bg-[#0B1120]/95 backdrop-blur-md border border-slate-700/90 rounded-2xl p-3.5 shadow-[0_16px_42px_rgba(0,0,0,0.68)] pointer-events-auto"
        >
          {/* Category Tabs + Eraser & Snap Utilities */}
          <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 mb-2.5 border-b border-slate-800/90">
            <div className="flex flex-wrap items-center gap-1.5">
              {(
                [
                  { id: 'platforms', label: '1. Plataformas & Chegada' },
                  { id: 'items', label: '2. Caixas de Itens (12)' },
                  { id: 'boosts', label: '3. Impulsos & Cristais' },
                  { id: 'hazards', label: '4. Perigos' },
                  { id: 'actions', label: '5. Modelos & Bioma' },
                ] as Array<{ id: EditorToolCategory; label: string }>
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveCategory(tab.id)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                    activeCategory === tab.id
                      ? 'bg-amber-500 text-slate-950 font-bold shadow-sm'
                      : 'bg-slate-900/95 text-slate-300 hover:bg-slate-800 hover:text-white border border-slate-700/80'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                data-testid="tool-eraser"
                onClick={() =>
                  setSelectedTool({
                    kind: 'eraser',
                  })
                }
                title="Selecione e segure o clique para apagar vários objetos"
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all cursor-pointer ${
                  selectedTool.kind === 'eraser'
                    ? 'bg-red-500/25 border-red-400 text-red-200 font-bold ring-1 ring-red-400/50'
                    : 'bg-slate-900/95 border-slate-700 text-slate-300 hover:text-white hover:border-slate-500'
                }`}
              >
                Borracha (Segurar / Dir.)
              </button>
              <button
                type="button"
                onClick={() => setSnapEnabled((v) => !v)}
                className={`px-2.5 py-1.5 rounded-xl text-xs font-mono-num border transition-colors cursor-pointer ${
                  snapEnabled
                    ? 'bg-sky-500/20 border-sky-400/75 text-sky-200 font-semibold'
                    : 'bg-slate-900/95 border-slate-700 text-slate-400'
                }`}
              >
                Grade 16px: {snapEnabled ? 'ON' : 'OFF'}
              </button>
            </div>
          </div>

          {/* Active Category Tools */}
          {activeCategory === 'platforms' && (
            <div className="flex flex-wrap items-center gap-2">
              {[
                {
                  label: 'Sólida Curta (120)',
                  spec: { kind: 'platform', platformKind: 'solid', width: 120 } as EditorToolSpec,
                },
                {
                  label: 'Sólida Média (190)',
                  spec: { kind: 'platform', platformKind: 'solid', width: 190 } as EditorToolSpec,
                },
                {
                  label: 'Sólida Grande (280)',
                  spec: { kind: 'platform', platformKind: 'solid', width: 280 } as EditorToolSpec,
                },
                {
                  label: 'Móvel Horiz.',
                  spec: {
                    kind: 'platform',
                    platformKind: 'moving',
                    width: 170,
                    moveAxis: 'x',
                  } as EditorToolSpec,
                },
                {
                  label: 'Móvel Vert.',
                  spec: {
                    kind: 'platform',
                    platformKind: 'moving',
                    width: 170,
                    moveAxis: 'y',
                  } as EditorToolSpec,
                },
                {
                  label: 'Esteira >>',
                  spec: {
                    kind: 'platform',
                    platformKind: 'conveyor',
                    width: 190,
                    conveyorDir: 1,
                  } as EditorToolSpec,
                },
                {
                  label: 'Esteira <<',
                  spec: {
                    kind: 'platform',
                    platformKind: 'conveyor',
                    width: 190,
                    conveyorDir: -1,
                  } as EditorToolSpec,
                },
                {
                  label: 'Frágil',
                  spec: {
                    kind: 'platform',
                    platformKind: 'crumbling',
                    width: 150,
                  } as EditorToolSpec,
                },
                {
                  label: 'Checkpoint',
                  spec: {
                    kind: 'platform',
                    platformKind: 'checkpoint',
                    width: 210,
                  } as EditorToolSpec,
                },
                {
                  label: 'Mover Portal de Chegada',
                  spec: { kind: 'move_finish' } as EditorToolSpec,
                },
              ].map((item) => {
                const isSelected =
                  JSON.stringify(selectedTool) === JSON.stringify(item.spec);
                return (
                  <button
                    key={item.label}
                    type="button"
                    onClick={() => setSelectedTool(item.spec)}
                    className={`px-3 py-2 rounded-xl text-xs font-semibold border transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-amber-500/25 border-amber-400 text-amber-200 font-bold ring-1 ring-amber-400/50'
                        : item.spec.kind === 'move_finish'
                        ? 'bg-emerald-950/75 border-emerald-500/60 text-emerald-200 hover:bg-emerald-900/75'
                        : 'bg-slate-900/95 border-slate-700/90 text-slate-200 hover:border-slate-500'
                    }`}
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>
          )}

          {activeCategory === 'items' && (
            <div className="grid grid-cols-4 sm:grid-cols-6 gap-1.5">
              {ALL_ITEM_TYPES.map((itemType) => {
                const active =
                  selectedTool.kind === 'item_box' &&
                  selectedTool.itemType === itemType;
                return (
                  <button
                    key={itemType}
                    type="button"
                    onClick={() =>
                      setSelectedTool({
                        kind: 'item_box',
                        itemType,
                      })
                    }
                    className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border text-left transition-all cursor-pointer ${
                      active
                        ? 'bg-amber-500/25 border-amber-400 text-white font-bold ring-1 ring-amber-400/50'
                        : 'bg-slate-900/95 border-slate-800 text-slate-200 hover:border-slate-600'
                    }`}
                  >
                    <ItemIconSvg type={itemType} size={18} />
                    <span className="text-[11px] truncate">
                      {ITEM_METADATA[itemType].name.split(' ')[0]}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {activeCategory === 'boosts' && (
            <div className="flex flex-wrap items-center gap-2">
              {[
                { label: 'Mola Propulsora', spec: { kind: 'bounce_pad' } as EditorToolSpec },
                { label: 'Vento Ascendente', spec: { kind: 'wind_zone' } as EditorToolSpec },
                { label: 'Anel Propulsor', spec: { kind: 'boost_ring' } as EditorToolSpec },
                { label: 'Rebatedor (Bumper)', spec: { kind: 'bumper' } as EditorToolSpec },
                { label: 'Cristal de Pontos', spec: { kind: 'crystal' } as EditorToolSpec },
              ].map((item) => {
                const isSelected = selectedTool.kind === item.spec.kind;
                return (
                  <button
                    key={item.label}
                    type="button"
                    onClick={() => setSelectedTool(item.spec)}
                    className={`px-3 py-2 rounded-xl text-xs font-semibold border transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-amber-500/25 border-amber-400 text-amber-200 font-bold ring-1 ring-amber-400/50'
                        : 'bg-slate-900/95 border-slate-700/90 text-slate-200 hover:border-slate-500'
                    }`}
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>
          )}

          {activeCategory === 'hazards' && (
            <div className="flex flex-wrap items-center gap-2">
              {[
                {
                  label: 'Serra Circular',
                  spec: { kind: 'hazard', hazardKind: 'saw' } as EditorToolSpec,
                },
                {
                  label: 'Feixe Laser Temporal',
                  spec: { kind: 'hazard', hazardKind: 'laser' } as EditorToolSpec,
                },
                {
                  label: 'Drone Patrulheiro',
                  spec: { kind: 'hazard', hazardKind: 'drone' } as EditorToolSpec,
                },
              ].map((item) => {
                const isSelected =
                  selectedTool.kind === 'hazard' &&
                  item.spec.kind === 'hazard' &&
                  selectedTool.hazardKind === item.spec.hazardKind;
                return (
                  <button
                    key={item.label}
                    type="button"
                    onClick={() => setSelectedTool(item.spec)}
                    className={`px-3 py-2 rounded-xl text-xs font-semibold border transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-red-500/25 border-red-400 text-red-200 font-bold ring-1 ring-red-400/50'
                        : 'bg-slate-900/95 border-slate-700/90 text-slate-200 hover:border-slate-500'
                    }`}
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>
          )}

          {activeCategory === 'actions' && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  const next = createTemplateEditorStage(Date.now());
                  camRef.current.x = next.startX + 180;
                  camRef.current.y = next.startY - 120;
                  applyStageEdit(
                    next,
                    'Base dinâmica em "S" gerada! Edite livremente e teste para validar.'
                  );
                }}
                className="px-3 py-2 rounded-xl text-xs font-semibold bg-sky-950/85 border border-sky-500/60 text-sky-200 hover:bg-sky-900/85 cursor-pointer"
              >
                Gerar Percurso Base em &apos;S&apos;
              </button>
              <button
                type="button"
                onClick={() => {
                  const next = createBlankEditorStage(1, stageRef.current.biome, Date.now());
                  camRef.current.x = 380;
                  camRef.current.y = -60;
                  applyStageEdit(next, 'Mapa zerado! Coloque suas plataformas e itens livremente.');
                }}
                className="px-3 py-2 rounded-xl text-xs font-semibold bg-slate-900 border border-slate-700 text-slate-200 hover:bg-slate-800 cursor-pointer"
              >
                Zerar Mapa (0 Itens)
              </button>
              {(['foundry', 'wind_tower', 'orbital_core'] as BiomeId[]).map((bId) => (
                <button
                  key={bId}
                  type="button"
                  onClick={() => {
                    const next = { ...stageRef.current, biome: bId };
                    setStage(next);
                    stageRef.current = next;
                  }}
                  className={`px-3 py-2 rounded-xl text-xs font-semibold border cursor-pointer ${
                    stage.biome === bId
                      ? 'bg-amber-500/25 border-amber-400 text-amber-200 font-bold'
                      : 'bg-slate-900 border-slate-700 text-slate-300'
                  }`}
                >
                  Bioma: {BIOME_CONFIGS[bId].name}
                </button>
              ))}
            </div>
          )}

          <div className="mt-2.5 pt-2 border-t border-slate-800/90 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400">
            <div className="flex flex-wrap items-center gap-2">
              <span className="bg-slate-900/90 border border-slate-800 px-2 py-0.5 rounded text-slate-300">
                Clique Esq: Colocar
              </span>
              <span className="bg-slate-900/90 border border-slate-800 px-2 py-0.5 rounded text-slate-300">
                Borracha / Clique Dir (Segurar): Apagar Vários
              </span>
              <span className="bg-slate-900/90 border border-slate-800 px-2 py-0.5 rounded text-slate-300">
                Clique do Meio / WASD: Mover Câmera
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  camRef.current.x = stageRef.current.startX + 120;
                  camRef.current.y = stageRef.current.startY - 60;
                }}
                className="text-emerald-400 hover:text-emerald-300 font-semibold hover:underline cursor-pointer"
              >
                Ir p/ Largada
              </button>
              <span className="text-slate-600">·</span>
              <button
                type="button"
                onClick={() => {
                  camRef.current.x = stageRef.current.finishX;
                  camRef.current.y = stageRef.current.finishY;
                }}
                className="text-amber-400 hover:text-amber-300 font-semibold hover:underline cursor-pointer"
              >
                Ir p/ Chegada
              </button>
            </div>
          </div>
        </div>
      )}

      {/* RIGHT COLUMN: Expanded Creators Card (No Scrollbar) + Aligned 2D Minimap */}
      <div className="fixed bottom-3 right-3 z-30 w-80 sm:w-[340px] flex flex-col gap-2.5 items-stretch pointer-events-auto">
        {/* Creators Progress Card — Larger & Never Needs a Scrollbar */}
        <div
          data-testid="editor-creators-card"
          className="w-full bg-[#0B1120]/95 backdrop-blur-md border border-slate-700/90 rounded-2xl p-3.5 shadow-[0_14px_36px_rgba(0,0,0,0.65)]"
        >
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-amber-400" />
              <span className="text-xs font-display font-bold uppercase tracking-wider text-slate-100">
                Criadores na Partida
              </span>
            </div>
            <span className="font-mono-num text-xs font-bold text-amber-300 bg-amber-500/15 border border-amber-400/40 px-2 py-0.5 rounded-lg">
              {readyCount}/{totalCreators} prontos
            </span>
          </div>

          {/* Readiness Progress Bar */}
          <div className="w-full h-1.5 bg-slate-900 border border-slate-800 rounded-full overflow-hidden mb-2.5">
            <div
              className="h-full bg-gradient-to-r from-amber-400 to-emerald-400 transition-all duration-300"
              style={{ width: `${readyPct}%` }}
            />
          </div>

          {/* All Creators Listed Without Scrollbar (1 col up to 5 players, 2 cols for 6..10 players) */}
          <div
            data-testid="editor-creators-list"
            className={
              editorState.creators.length > 5
                ? 'grid grid-cols-2 gap-1.5'
                : 'flex flex-col gap-1.5'
            }
          >
            {editorState.creators.map((c) => {
              const isMe = c.playerId === playerId;
              return (
                <div
                  key={c.playerId}
                  className={`flex items-center justify-between gap-2 rounded-xl px-2.5 py-2 border transition-colors ${
                    isMe
                      ? 'bg-slate-900/95 border-amber-500/50 shadow-sm'
                      : 'bg-slate-900/80 border-slate-800/90'
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="shrink-0">
                      <RobotAvatarSvg colorIndex={c.colorIndex} size={20} />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-bold text-slate-100 truncate">
                          {c.playerName}
                        </span>
                        {isMe && (
                          <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 border border-amber-400/40 shrink-0">
                            Você
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <span
                    className={`font-mono-num text-[11px] font-bold shrink-0 px-2 py-0.5 rounded-lg border ${
                      c.submitted
                        ? 'bg-emerald-950/90 border-emerald-500/60 text-emerald-300'
                        : c.validated
                        ? 'bg-sky-950/90 border-sky-500/60 text-sky-300'
                        : 'bg-amber-950/75 border-amber-500/45 text-amber-300'
                    }`}
                  >
                    {c.submitted
                      ? c.creatorBestTime
                        ? `Pronto (${c.creatorBestTime.toFixed(1)}s)`
                        : 'Confirmado'
                      : c.validated
                      ? `Validado (${c.creatorBestTime?.toFixed(1)}s)`
                      : `Editando (${c.objectCount} obj)`}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Interactive 2D Editor Minimap (Aligned with Creators Card) */}
        <div
          data-testid="editor-minimap"
          className="w-full bg-[#0B1120]/95 backdrop-blur-md border border-slate-700/90 rounded-2xl p-3 shadow-[0_14px_36px_rgba(0,0,0,0.65)]"
        >
          <div className="flex items-center justify-between gap-2 mb-2">
            <span className="text-xs font-display font-bold uppercase tracking-wider text-slate-200">
              Minimapa do Editor
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                data-testid="editor-zoom-out-btn"
                onClick={() => applyEditorZoom(stepCameraZoomLevel(editorZoom, -1))}
                title="Afastar câmera (Zoom Out / Roda do Mouse)"
                className="text-xs font-mono-num font-bold text-slate-200 hover:text-amber-300 bg-slate-800/95 hover:bg-slate-700 border border-slate-600/80 px-2 py-0.5 rounded-lg cursor-pointer"
              >
                -
              </button>
              <button
                type="button"
                data-testid="editor-zoom-cycle-btn"
                onClick={() => applyEditorZoom(cycleCameraZoomLevel(editorZoom))}
                title="Alternar nível de zoom (10 níveis)"
                className="text-[11px] font-mono-num font-bold text-amber-300 bg-slate-800/95 hover:bg-slate-700 border border-slate-600/80 px-2.5 py-0.5 rounded-lg cursor-pointer"
              >
                {editorZoom.toFixed(2)}x
              </button>
              <button
                type="button"
                data-testid="editor-zoom-in-btn"
                onClick={() => applyEditorZoom(stepCameraZoomLevel(editorZoom, 1))}
                title="Aproximar câmera (Zoom In / Roda do Mouse)"
                className="text-xs font-mono-num font-bold text-slate-200 hover:text-amber-300 bg-slate-800/95 hover:bg-slate-700 border border-slate-600/80 px-2 py-0.5 rounded-lg cursor-pointer"
              >
                +
              </button>
            </div>
          </div>
          <canvas
            ref={minimapRef}
            width={312}
            height={128}
            className="block w-full rounded-xl bg-[#070B14] border border-slate-800/90"
          />
          <div className="mt-1.5 flex items-center justify-between text-[11px] font-medium text-slate-400">
            <span className="text-emerald-400 flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-emerald-400" />
              Largada
            </span>
            <span className="text-sky-400 flex items-center gap-1">
              <span className="w-2 h-0.5 bg-sky-400" />
              Traçado
            </span>
            <span className="text-amber-300 font-semibold flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-amber-400" />
              Chegada
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function drawEditorOverlay(
  ctx: CanvasRenderingContext2D,
  viewW: number,
  viewH: number,
  cam: { x: number; y: number; zoom: number },
  pointer: { worldX: number; worldY: number; inside: boolean; panning?: boolean },
  tool: EditorToolSpec,
  snap: boolean
): void {
  if (!pointer.inside || pointer.panning) return;

  ctx.save();
  ctx.translate(viewW * 0.5, viewH * 0.54);
  ctx.scale(cam.zoom, cam.zoom);
  ctx.translate(-cam.x, -cam.y);

  const gx = snapCoord(pointer.worldX, 16, snap);
  const gy = snapCoord(pointer.worldY, 16, snap);

  ctx.save();
  if (tool.kind === 'platform') {
    const w = tool.width;
    const h = tool.platformKind === 'checkpoint' ? 24 : 22;
    ctx.fillStyle = 'rgba(56, 189, 248, 0.25)';
    ctx.strokeStyle = '#38BDF8';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(gx - w * 0.5, gy - h * 0.5, w, h, 6);
    ctx.fill();
    ctx.stroke();
  } else if (tool.kind === 'move_finish') {
    // Shows both the Finish platform footprint at (gx, gy) and the portal above it
    ctx.fillStyle = 'rgba(250, 204, 21, 0.22)';
    ctx.strokeStyle = '#FACC15';
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.roundRect(gx - 36, gy - 88, 72, 88, 10);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.roundRect(gx - 115, gy, 230, 26, 6);
    ctx.fill();
    ctx.stroke();
  } else if (tool.kind === 'wind_zone') {
    ctx.fillStyle = 'rgba(56, 189, 248, 0.18)';
    ctx.strokeStyle = '#38BDF8';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(gx - 44, gy - 95, 88, 190, 8);
    ctx.fill();
    ctx.stroke();
  } else if (tool.kind === 'bounce_pad') {
    ctx.fillStyle = 'rgba(251, 191, 36, 0.28)';
    ctx.strokeStyle = '#FBBF24';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(gx - 21, gy - 14, 42, 14, 4);
    ctx.fill();
    ctx.stroke();
  } else if (tool.kind === 'eraser') {
    ctx.strokeStyle = '#EF4444';
    ctx.fillStyle = 'rgba(239, 68, 68, 0.18)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(pointer.worldX, pointer.worldY, 42, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  } else {
    ctx.strokeStyle = '#FBBF24';
    ctx.fillStyle = 'rgba(251, 191, 36, 0.22)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(gx, gy, 20, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();

  ctx.restore();
}

function drawEditorMinimap(
  canvas: HTMLCanvasElement,
  stage: StageData,
  cam: { x: number; y: number; zoom: number },
  testRobot: { x: number; y: number; colorIndex: number } | null
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const W = canvas.width;
  const H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  ctx.fillStyle = '#070B14';
  ctx.fillRect(0, 0, W, H);

  let minX = Math.min(stage.startX, stage.finishX, cam.x) - 220;
  let maxX = Math.max(stage.startX + 180, stage.finishX + stage.finishW, cam.x) + 220;
  let minY = Math.min(stage.startY, stage.finishY, cam.y) - 200;
  let maxY = Math.max(stage.startY, stage.finishY + stage.finishH, cam.y) + 200;

  for (const p of stage.platforms) {
    minX = Math.min(minX, p.baseX - 80);
    maxX = Math.max(maxX, p.baseX + p.w + 80);
    minY = Math.min(minY, p.baseY - 110);
    maxY = Math.max(maxY, p.baseY + p.h + 90);
  }
  for (const box of stage.itemBoxes) {
    minX = Math.min(minX, box.x - 60);
    maxX = Math.max(maxX, box.x + 60);
    minY = Math.min(minY, box.y - 60);
    maxY = Math.max(maxY, box.y + 60);
  }
  for (const ring of stage.boostRings) {
    minX = Math.min(minX, ring.x - 60);
    maxX = Math.max(maxX, ring.x + 60);
    minY = Math.min(minY, ring.y - 60);
    maxY = Math.max(maxY, ring.y + 60);
  }
  for (const wz of stage.windZones) {
    minX = Math.min(minX, wz.x - 60);
    maxX = Math.max(maxX, wz.x + wz.w + 60);
    minY = Math.min(minY, wz.y - 60);
    maxY = Math.max(maxY, wz.y + wz.h + 60);
  }

  const worldW = Math.max(400, maxX - minX);
  const worldH = Math.max(300, maxY - minY);
  const pad = 10;
  const scale = Math.min((W - pad * 2) / worldW, (H - pad * 2) / worldH);
  const offsetX = (W - worldW * scale) * 0.5;
  const offsetY = (H - worldH * scale) * 0.5;

  const toMapX = (wx: number) => offsetX + (wx - minX) * scale;
  const toMapY = (wy: number) => offsetY + (wy - minY) * scale;

  // Spine
  if (stage.platforms.length > 1) {
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.28)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i < stage.platforms.length; i++) {
      const p = stage.platforms[i];
      const px = toMapX(p.baseX + p.w * 0.5);
      const py = toMapY(p.baseY);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
  }

  for (const p of stage.platforms) {
    const px = toMapX(p.baseX);
    const py = toMapY(p.baseY);
    const pw = Math.max(4, p.w * scale);
    const ph = Math.max(2.5, p.h * scale);
    ctx.fillStyle =
      p.kind === 'start'
        ? '#10B981'
        : p.kind === 'finish'
        ? '#FACC15'
        : p.kind === 'checkpoint'
        ? '#38BDF8'
        : '#64748B';
    ctx.fillRect(px, py, pw, ph);
  }

  // Finish beacon
  const fx = toMapX(stage.finishX + stage.finishW * 0.5);
  const fy = toMapY(stage.finishY + stage.finishH * 0.5);
  ctx.fillStyle = '#FACC15';
  ctx.beginPath();
  ctx.arc(fx, fy, 4, 0, Math.PI * 2);
  ctx.fill();

  // Camera rect
  const vw = (1280 / Math.max(0.65, cam.zoom)) * scale;
  const vh = (720 / Math.max(0.65, cam.zoom)) * scale;
  ctx.strokeStyle = 'rgba(250, 204, 21, 0.65)';
  ctx.lineWidth = 1.2;
  ctx.strokeRect(toMapX(cam.x) - vw * 0.5, toMapY(cam.y) - vh * 0.5, vw, vh);

  if (testRobot) {
    const pal = ROBOT_PALETTES[testRobot.colorIndex % ROBOT_PALETTES.length];
    ctx.fillStyle = pal.body;
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(toMapX(testRobot.x), toMapY(testRobot.y), 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
}
