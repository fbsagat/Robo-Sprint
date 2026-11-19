import React, { useEffect, useRef } from 'react';
import { BIOME_CONFIGS, ITEM_METADATA, ROBOT_PALETTES } from '../game/constants';
import { countEditorStageObjects, EDITOR_MAP_PREVIEW_TIME } from '../game/editor';
import { getSortedRacers } from '../game/physics';
import type { EditorModeState, GameMode, RobotState, StageData } from '../game/types';
import { ItemIconSvg, PauseIconSvg, SoundIconSvg } from './Icons';

interface GameHudProps {
  stage: StageData;
  robots: RobotState[];
  localPlayerId: string;
  raceTime: number;
  countdownTimer: number;
  phase: 'map_preview' | 'countdown' | 'racing';
  gameMode?: GameMode;
  editorState?: EditorModeState;
  muted: boolean;
  feedText: string | null;
  cameraZoom: number;
  gamepadConnected?: boolean;
  previewCamera?: { x: number; y: number; zoom: number; mode: 'auto_tour' | 'free' };
  onPreviewFitMap?: () => void;
  onPreviewFocusStart?: () => void;
  onPreviewFocusFinish?: () => void;
  onPreviewAutoTour?: () => void;
  onSkipMapPreview?: () => void;
  onCycleZoom: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onToggleMute: () => void;
  onPause: () => void;
  onUseItem: () => void;
  onDash: () => void;
  onTouchControl: (key: 'left' | 'right' | 'jump', down: boolean) => void;
}

function MiniMapRadar({
  stage,
  robots,
  localPlayerId,
  cameraZoom,
  previewCamera,
  gamepadConnected,
  onCycleZoom,
  onZoomIn,
  onZoomOut,
}: {
  stage: StageData;
  robots: RobotState[];
  localPlayerId: string;
  cameraZoom: number;
  previewCamera?: { x: number; y: number; zoom: number; mode: 'auto_tour' | 'free' };
  gamepadConnected?: boolean;
  onCycleZoom: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const cw = canvas.width;
    const ch = canvas.height;
    ctx.clearRect(0, 0, cw, ch);

    // Background radar surface
    ctx.fillStyle = '#090E1A';
    ctx.fillRect(0, 0, cw, ch);

    // Subtle radar grid lines
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let gx = 28; gx < cw; gx += 28) {
      ctx.moveTo(gx, 0);
      ctx.lineTo(gx, ch);
    }
    for (let gy = 26; gy < ch; gy += 26) {
      ctx.moveTo(0, gy);
      ctx.lineTo(cw, gy);
    }
    ctx.stroke();

    if (!stage.platforms.length) return;

    // Compute world bounds across all platforms + finish portal
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    for (const p of stage.platforms) {
      if (p.x < minX) minX = p.x;
      if (p.x + p.w > maxX) maxX = p.x + p.w;
      if (p.y < minY) minY = p.y;
      if (p.y + p.h > maxY) maxY = p.y + p.h;
    }
    minX = Math.min(minX, stage.finishX) - 110;
    maxX = Math.max(maxX, stage.finishX + stage.finishW) + 110;
    minY = Math.min(minY, stage.finishY) - 130;
    maxY = Math.max(maxY, stage.startY) + 110;

    const worldW = Math.max(400, maxX - minX);
    const worldH = Math.max(300, maxY - minY);
    const pad = 10;
    const availW = cw - pad * 2;
    const availH = ch - pad * 2;
    const scale = Math.min(availW / worldW, availH / worldH);

    const offsetX = pad + (availW - worldW * scale) * 0.5;
    const offsetY = pad + (availH - worldH * scale) * 0.5;

    const toMapX = (wx: number) => offsetX + (wx - minX) * scale;
    const toMapY = (wy: number) => offsetY + (wy - minY) * scale;

    // 1. Draw connected S-curve route spine linking platform centers
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.26)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    stage.platforms.forEach((p, idx) => {
      const px = toMapX(p.x + p.w * 0.5);
      const py = toMapY(p.y);
      if (idx === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.stroke();

    // 2. Draw all platforms color-coded by role
    for (const p of stage.platforms) {
      const px = toMapX(p.x);
      const py = toMapY(p.y);
      const pw = Math.max(4, p.w * scale);
      const ph = Math.max(2.5, p.h * scale);

      if (p.kind === 'start') {
        ctx.fillStyle = '#10B981';
      } else if (p.kind === 'finish') {
        ctx.fillStyle = '#FACC15';
      } else if (p.kind === 'checkpoint') {
        ctx.fillStyle = '#38BDF8';
      } else if (p.kind === 'moving') {
        ctx.fillStyle = '#F59E0B';
      } else {
        ctx.fillStyle = '#64748B';
      }
      ctx.fillRect(px, py, pw, ph);
    }

    // 3. Draw Finish Portal marker
    const fx = toMapX(stage.finishX + stage.finishW * 0.5);
    const fy = toMapY(stage.finishY + stage.finishH * 0.5);
    ctx.fillStyle = '#FACC15';
    ctx.beginPath();
    ctx.arc(fx, fy, 4, 0, Math.PI * 2);
    ctx.fill();

    // 4. Draw current zoomed-in Camera Viewport frame around focus robot or preview camera
    const localRobot = robots.find((r) => r.id === localPlayerId);
    const sorted = getSortedRacers(robots);
    const focusRobot =
      localRobot && !localRobot.finished ? localRobot : sorted[0] ?? localRobot;

    if (previewCamera) {
      const activeZoom = Math.max(0.55, previewCamera.zoom);
      const viewWWorld = 1280 / activeZoom;
      const viewHWorld = 800 / activeZoom;
      const vx = toMapX(previewCamera.x - viewWWorld * 0.5);
      const vy = toMapY(previewCamera.y - viewHWorld * 0.5);
      const vw = viewWWorld * scale;
      const vh = viewHWorld * scale;

      ctx.strokeStyle = 'rgba(56, 189, 248, 0.85)';
      ctx.fillStyle = 'rgba(56, 189, 248, 0.10)';
      ctx.lineWidth = 1.5;
      ctx.fillRect(vx, vy, vw, vh);
      ctx.strokeRect(vx, vy, vw, vh);
    } else if (focusRobot) {
      const viewWWorld = 1280 / Math.max(0.55, cameraZoom);
      const viewHWorld = 800 / Math.max(0.55, cameraZoom);
      const vx = toMapX(focusRobot.x + focusRobot.w * 0.5 - viewWWorld * 0.5);
      const vy = toMapY(focusRobot.y - 16 - viewHWorld * 0.5);
      const vw = viewWWorld * scale;
      const vh = viewHWorld * scale;

      ctx.strokeStyle = 'rgba(250, 204, 21, 0.55)';
      ctx.fillStyle = 'rgba(250, 204, 21, 0.06)';
      ctx.lineWidth = 1.2;
      ctx.fillRect(vx, vy, vw, vh);
      ctx.strokeRect(vx, vy, vw, vh);
    }

    // 5. Draw all robots (rivals first, local player last on top)
    const leaderId = sorted[0]?.id;
    for (const r of robots) {
      if (r.id === localPlayerId) continue;
      const pal = ROBOT_PALETTES[r.colorIndex % ROBOT_PALETTES.length];
      const rx = toMapX(r.x + r.w * 0.5);
      const ry = toMapY(r.y + r.h * 0.5);

      ctx.fillStyle = pal.body;
      ctx.strokeStyle = r.id === leaderId ? '#FACC15' : '#090D16';
      ctx.lineWidth = r.id === leaderId ? 1.6 : 1.2;
      ctx.beginPath();
      ctx.arc(rx, ry, 3.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    if (localRobot) {
      const pal = ROBOT_PALETTES[localRobot.colorIndex % ROBOT_PALETTES.length];
      const rx = toMapX(localRobot.x + localRobot.w * 0.5);
      const ry = toMapY(localRobot.y + localRobot.h * 0.5);

      // Outer white beacon halo for local player
      ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
      ctx.beginPath();
      ctx.arc(rx, ry, 7, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = pal.body;
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(rx, ry, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }, [stage, robots, localPlayerId, cameraZoom, previewCamera]);

  return (
    <div
      data-testid="minimap-radar"
      aria-label="Minimapa da pista"
      className="bg-[#0F172A]/92 border border-slate-700/85 rounded-xl p-2.5 shadow-xl pointer-events-auto"
    >
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-bold text-slate-200 tracking-tight">
            Minimapa
          </span>
          {gamepadConnected && (
            <span
              data-testid="gamepad-badge"
              className="text-[9px] font-bold text-emerald-300 bg-emerald-950/90 border border-emerald-500/50 px-1.5 py-0.5 rounded"
            >
              Gamepad
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            tabIndex={-1}
            data-testid="zoom-out-btn"
            aria-label="Afastar câmera (Zoom Out)"
            title="Afastar câmera [- ou Roda do Mouse]"
            onClick={(e) => {
              e.currentTarget.blur();
              onZoomOut();
            }}
            className="text-[11px] font-mono-num font-bold text-slate-200 hover:text-white bg-slate-800/90 hover:bg-slate-700 border border-slate-600/80 w-5 h-5 flex items-center justify-center rounded transition-colors cursor-pointer"
          >
            -
          </button>
          <button
            type="button"
            tabIndex={-1}
            data-testid="zoom-cycle-btn"
            title="Alternar nível de zoom [Z ou Roda do Mouse]"
            onClick={(e) => {
              e.currentTarget.blur();
              onCycleZoom();
            }}
            className="text-[10px] font-mono-num font-semibold text-amber-300 hover:text-amber-200 bg-slate-800/90 hover:bg-slate-700 border border-slate-600/80 px-1.5 py-0.5 rounded transition-colors cursor-pointer whitespace-nowrap"
          >
            {cameraZoom.toFixed(2)}x
          </button>
          <button
            type="button"
            tabIndex={-1}
            data-testid="zoom-in-btn"
            aria-label="Aproximar câmera (Zoom In)"
            title="Aproximar câmera [+ ou Roda do Mouse]"
            onClick={(e) => {
              e.currentTarget.blur();
              onZoomIn();
            }}
            className="text-[11px] font-mono-num font-bold text-slate-200 hover:text-white bg-slate-800/90 hover:bg-slate-700 border border-slate-600/80 w-5 h-5 flex items-center justify-center rounded transition-colors cursor-pointer"
          >
            +
          </button>
        </div>
      </div>
      <canvas
        ref={canvasRef}
        width={216}
        height={124}
        className="block rounded-lg border border-slate-800"
      />
      <div className="mt-1.5 flex items-center justify-between text-[10px] text-slate-400">
        <span>Roda do mouse: Zoom</span>
        <span aria-hidden="true">·</span>
        <span className="text-sky-300">Checkpoint</span>
        <span aria-hidden="true">·</span>
        <span className="text-amber-300">Chegada</span>
      </div>
    </div>
  );
}

export function GameHud({
  stage,
  robots,
  localPlayerId,
  raceTime,
  countdownTimer,
  phase,
  gameMode,
  editorState,
  muted,
  feedText,
  cameraZoom,
  gamepadConnected,
  previewCamera,
  onPreviewFitMap,
  onPreviewFocusStart,
  onPreviewFocusFinish,
  onPreviewAutoTour,
  onSkipMapPreview,
  onCycleZoom,
  onZoomIn,
  onZoomOut,
  onToggleMute,
  onPause,
  onUseItem,
  onDash,
  onTouchControl,
}: GameHudProps) {
  const localRobot = robots.find((r) => r.id === localPlayerId);
  const sorted = getSortedRacers(robots);
  const rank = Math.max(1, sorted.findIndex((r) => r.id === localPlayerId) + 1);

  const rawGoalDeltaY = stage.startY - stage.finishY;
  const isGoalBelow = rawGoalDeltaY < -30;
  const currentAltitude = localRobot
    ? Math.max(
        0,
        Math.round(
          (isGoalBelow ? localRobot.y - stage.startY : stage.startY - localRobot.y) / 10
        )
      )
    : 0;
  const targetAltitude = Math.max(1, Math.round(stage.targetClimb / 10));
  const goalVerticalDeltaMeters = Math.round(Math.abs(rawGoalDeltaY) / 10);
  const goalHorizontalDeltaMeters = Math.round(Math.abs(stage.finishX - stage.startX) / 10);
  const totalStageObjects = countEditorStageObjects(stage);
  const biomeName = BIOME_CONFIGS[stage.biome]?.name ?? 'Forja Industrial';

  const formatTime = (t: number) => {
    const mins = Math.floor(t / 60);
    const secs = Math.floor(t % 60);
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  const heldItem = localRobot?.heldItem ?? null;
  const itemMeta = heldItem ? ITEM_METADATA[heldItem] : null;
  const dashReady = (localRobot?.dashCooldown ?? 0) <= 0.05;
  const dashPct = localRobot
    ? Math.round(
        (1 - Math.min(1, localRobot.dashCooldown / Math.max(0.1, localRobot.dashMaxCooldown))) * 100
      )
    : 100;

  return (
    <div className="fixed inset-0 z-10 pointer-events-none flex flex-col justify-between p-3 sm:p-5">
      {/* Top Perimeter Clusters */}
      <div className="flex items-start justify-between gap-3">
        {/* Top-Left: Stage, Biome, Elevation, Speed & Timer */}
        <div className="bg-[#0F172A]/90 border border-slate-700/80 rounded-xl px-3.5 py-2 flex items-center gap-3.5 shadow-lg">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">
              {gameMode === 'editor' && editorState
                ? `Mapa ${editorState.currentMapIndex + 1} de ${editorState.totalMaps}`
                : `Fase ${stage.stageNumber}`}
            </div>
            <div className="text-xs font-semibold text-amber-300 leading-tight whitespace-nowrap">
              {gameMode === 'editor' && editorState?.currentMapCreatorName
                ? `Criador: ${editorState.currentMapCreatorName}`
                : biomeName}
            </div>
          </div>
          <div className="h-7 w-px bg-slate-700/80" />
          <div>
            <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">
              {isGoalBelow ? 'Descida' : 'Subida'}
            </div>
            <div className="font-mono-num font-bold text-sm text-sky-300 leading-tight whitespace-nowrap">
              {isGoalBelow ? `-${currentAltitude}m` : `+${currentAltitude}m`}{' '}
              <span className="text-slate-500">
                / {isGoalBelow ? `-${goalVerticalDeltaMeters}m` : `+${targetAltitude}m`}
              </span>
            </div>
          </div>
          <div className="h-7 w-px bg-slate-700/80 hidden sm:block" />
          <div className="hidden sm:block">
            <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">
              Velocidade
            </div>
            <div className="font-mono-num font-bold text-sm text-amber-300 leading-tight whitespace-nowrap">
              {Math.round(Math.hypot(localRobot?.vx ?? 0, (localRobot?.vy ?? 0) * 0.35) * 0.18)} <span className="text-[10px] text-slate-400">km/h</span>
            </div>
          </div>
          <div className="h-7 w-px bg-slate-700/80" />
          <div>
            <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">
              Cristais
            </div>
            <div className="font-mono-num font-bold text-sm text-emerald-300 leading-tight whitespace-nowrap">
              ◆ {localRobot?.crystals ?? 0}
            </div>
          </div>
          <div className="h-7 w-px bg-slate-700/80 hidden md:block" />
          <div className="hidden md:block">
            <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">
              {gameMode === 'editor' ? 'Tempo / Limite' : 'Tempo'}
            </div>
            <div className="font-mono-num font-bold text-sm text-slate-100 leading-tight whitespace-nowrap">
              {formatTime(raceTime)}
              {gameMode === 'editor' && editorState && (
                <span className="text-slate-400 text-xs">
                  {' '}
                  / {editorState.currentMapCourseLimit || 45}s
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Top-Center: Live Race Elevation + Progress Track */}
        <div className="hidden md:flex flex-col items-center gap-1.5">
          <div className="bg-[#0F172A]/90 border border-slate-700/80 rounded-xl px-4 py-2 w-72 lg:w-96 shadow-lg">
            <div className="w-full flex items-center justify-between text-[11px] text-slate-300 mb-1.5">
              <span className="font-semibold">
                Posição <span className="font-mono-num text-amber-400 font-bold">{rank}º</span> / {robots.length}
              </span>
              <span className="font-mono-num text-slate-300 font-semibold">
                {localRobot?.progress ?? 0}% concluído
              </span>
            </div>
            <div className="relative w-full h-3 bg-slate-900 rounded-full border border-slate-700/90 overflow-visible">
              {/* Progress fill for local player */}
              <div
                className="h-full rounded-l-full bg-sky-500/25"
                style={{ width: `${Math.min(100, Math.max(0, localRobot?.progress ?? 0))}%` }}
              />
              {/* Checkpoint milestone ticks at 33% and 66% */}
              <div className="absolute left-1/3 top-0 bottom-0 w-px bg-slate-600/80" title="Checkpoint 1" />
              <div className="absolute left-2/3 top-0 bottom-0 w-px bg-slate-600/80" title="Checkpoint 2" />
              {/* Checkered Finish Marker */}
              <div className="absolute right-0 top-1/2 -translate-y-1/2 w-3 h-4 bg-amber-400 border border-slate-950 rounded-xs" />
              {robots.map((r) => {
                const pal = ROBOT_PALETTES[r.colorIndex % ROBOT_PALETTES.length];
                const isMe = r.id === localPlayerId;
                return (
                  <div
                    key={r.id}
                    className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 rounded-full border ${
                      isMe ? 'w-4 h-4 border-2 border-white z-10 shadow' : 'w-2.5 h-2.5 border-slate-950'
                    }`}
                    style={{
                      left: `${Math.min(98, Math.max(2, r.progress))}%`,
                      backgroundColor: pal.body,
                    }}
                  />
                );
              })}
            </div>
          </div>

          {feedText && (
            <div className="bg-[#0F172A]/95 border border-amber-500/40 text-xs font-medium text-slate-100 px-3.5 py-1 rounded-lg shadow-lg">
              {feedText}
            </div>
          )}
        </div>

        {/* Top-Right: Utility Controls */}
        <div className="flex items-center gap-2 pointer-events-auto">
          <button
            type="button"
            tabIndex={-1}
            aria-label={muted ? 'Ativar som [M]' : 'Silenciar som [M]'}
            title="Som [M]"
            onClick={(e) => {
              e.currentTarget.blur();
              onToggleMute();
            }}
            className="w-10 h-10 flex items-center justify-center bg-[#0F172A]/90 hover:bg-slate-800 border border-slate-700 text-slate-200 rounded-xl shadow-lg cursor-pointer"
          >
            <SoundIconSvg muted={muted} />
          </button>
          <button
            type="button"
            tabIndex={-1}
            aria-label="Pausar [P]"
            title="Pausar [P]"
            onClick={(e) => {
              e.currentTarget.blur();
              onPause();
            }}
            className="w-10 h-10 flex items-center justify-center bg-[#0F172A]/90 hover:bg-slate-800 border border-slate-700 text-slate-200 rounded-xl shadow-lg cursor-pointer"
          >
            <PauseIconSvg />
          </button>
        </div>
      </div>

      {/* Pre-Match Map Observation Session Overlay (Editor Mode) - Docked to Top Perimeter so center view is 100% clear */}
      {phase === 'map_preview' && (
        <div
          data-testid="map-preview-overlay"
          className="fixed top-14 left-1/2 -translate-x-1/2 z-20 w-[calc(100%-1.5rem)] max-w-4xl flex flex-col items-center pointer-events-auto"
        >
          <div
            data-testid="map-preview-banner"
            className="w-full bg-[#0B1120]/88 backdrop-blur-md border border-sky-400/75 rounded-2xl px-4 py-2.5 shadow-[0_12px_32px_rgba(0,0,0,0.6)]"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-widest font-extrabold bg-sky-500/20 text-sky-300 border border-sky-400/40 px-2 py-0.5 rounded-md">
                    <span className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-pulse" />
                    Sessão de Observação · Mapa{' '}
                    {editorState ? `${editorState.currentMapIndex + 1} de ${editorState.totalMaps}` : stage.stageNumber}
                  </span>
                  <h2 className="font-display font-extrabold text-sm sm:text-base text-white truncate">
                    {editorState?.currentMapTitle || `Mapa #${stage.stageNumber}`}
                  </h2>
                  {editorState?.currentMapCreatorName && (
                    <span className="text-xs font-semibold text-amber-300">
                      por {editorState.currentMapCreatorName}
                    </span>
                  )}
                  <span className="text-[11px] font-semibold text-slate-400 hidden sm:inline">
                    · {biomeName} ({totalStageObjects} obj)
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-300">
                  <span className="bg-slate-900/90 border border-slate-700/80 px-2 py-0.5 rounded text-sky-200 font-medium">
                    Objetivo: {goalHorizontalDeltaMeters}m horiz. ·{' '}
                    {isGoalBelow
                      ? `${goalVerticalDeltaMeters}m abaixo da largada`
                      : `${goalVerticalDeltaMeters}m acima da largada`}
                  </span>
                  <span className="text-slate-400 hidden md:inline">
                    WASD / Setas / Arrastar Mouse: Mover Câmera · Roda: Zoom
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2.5">
                <div
                  data-testid="map-preview-timer"
                  className="bg-slate-900/95 border border-slate-700/90 rounded-xl px-3 py-1.5 text-center min-w-[96px]"
                >
                  <div className="flex items-center justify-center gap-1.5">
                    <span className="text-[9px] uppercase tracking-wider text-slate-400 font-bold">
                      Largada
                    </span>
                    <span className="font-mono-num font-extrabold text-lg text-amber-300 leading-none">
                      {Math.max(1, Math.ceil(countdownTimer))}s
                    </span>
                  </div>
                  <div className="w-full h-1 bg-slate-800 rounded-full overflow-hidden mt-1">
                    <div
                      className="h-full bg-sky-400 transition-all duration-150"
                      style={{
                        width: `${Math.min(
                          100,
                          Math.max(
                            0,
                            (countdownTimer /
                              (editorState?.previewTimeLimit || EDITOR_MAP_PREVIEW_TIME)) *
                              100
                          )
                        )}%`,
                      }}
                    />
                  </div>
                </div>

                {onSkipMapPreview && (
                  <button
                    type="button"
                    data-testid="skip-map-preview-btn"
                    onClick={(e) => {
                      e.currentTarget.blur();
                      onSkipMapPreview();
                    }}
                    className="bg-amber-500 hover:bg-amber-400 text-slate-950 font-display font-extrabold text-xs px-3.5 py-2 rounded-xl shadow-lg transition-colors cursor-pointer whitespace-nowrap"
                  >
                    Iniciar Agora [Espaço]
                  </button>
                )}
              </div>
            </div>

            {/* Interactive Camera Focus & Pan Bar during Map Observation */}
            <div
              data-testid="map-preview-controls"
              className="mt-2 pt-2 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-2"
            >
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[10px] uppercase tracking-wider font-bold text-slate-400 mr-1">
                  Câmera:
                </span>
                <button
                  type="button"
                  data-testid="preview-auto-tour-btn"
                  onClick={(e) => {
                    e.currentTarget.blur();
                    onPreviewAutoTour?.();
                  }}
                  className={`text-[11px] font-semibold px-2.5 py-0.5 rounded-lg border transition-colors cursor-pointer ${
                    previewCamera?.mode === 'auto_tour'
                      ? 'bg-sky-500/25 border-sky-400 text-sky-200'
                      : 'bg-slate-900/90 border-slate-700 text-slate-300 hover:bg-slate-800'
                  }`}
                >
                  Tour Automático
                </button>
                <button
                  type="button"
                  data-testid="preview-fit-map-btn"
                  onClick={(e) => {
                    e.currentTarget.blur();
                    onPreviewFitMap?.();
                  }}
                  className="text-[11px] font-semibold px-2.5 py-0.5 rounded-lg bg-slate-900/90 hover:bg-slate-800 border border-slate-700 text-slate-200 transition-colors cursor-pointer"
                >
                  Ver Mapa Inteiro
                </button>
                <button
                  type="button"
                  data-testid="preview-focus-start-btn"
                  onClick={(e) => {
                    e.currentTarget.blur();
                    onPreviewFocusStart?.();
                  }}
                  className="text-[11px] font-semibold px-2.5 py-0.5 rounded-lg bg-slate-900/90 hover:bg-slate-800 border border-emerald-500/50 text-emerald-300 transition-colors cursor-pointer"
                >
                  Largada
                </button>
                <button
                  type="button"
                  data-testid="preview-focus-finish-btn"
                  onClick={(e) => {
                    e.currentTarget.blur();
                    onPreviewFocusFinish?.();
                  }}
                  className="text-[11px] font-semibold px-2.5 py-0.5 rounded-lg bg-slate-900/90 hover:bg-slate-800 border border-amber-500/50 text-amber-300 transition-colors cursor-pointer"
                >
                  Objetivo (Chegada)
                </button>
              </div>

              <div className="text-[10px] text-slate-400 sm:hidden">
                Arraste ou use WASD/Setas para mover a câmera
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Center Countdown Banner */}
      {phase === 'countdown' && (
        <div className="self-center flex flex-col items-center">
          <div className="bg-[#0F172A]/92 border-2 border-amber-400 rounded-2xl px-8 py-4 text-center shadow-2xl">
            <div className="text-xs uppercase tracking-widest text-amber-300 font-semibold">
              {gameMode === 'editor' && editorState
                ? `Mapa ${editorState.currentMapIndex + 1}/${editorState.totalMaps} · ${
                    editorState.currentMapTitle || biomeName
                  }`
                : `Fase ${stage.stageNumber} · ${biomeName} · ${
                    isGoalBelow ? `Desça -${goalVerticalDeltaMeters}m` : `Suba +${targetAltitude}m`
                  }`}
            </div>
            <div className="font-display font-extrabold text-5xl text-white font-mono-num mt-1">
              {Math.max(1, Math.ceil(countdownTimer))}
            </div>
          </div>
        </div>
      )}

      {/* Bottom Perimeter: Active Item + Dash Gauge + Status Alerts + 2D Minimap */}
      <div className="flex items-end justify-between gap-3">
        <div className="flex items-end gap-2.5 pointer-events-auto">
          {/* Active Item Slot */}
          <button
            type="button"
            tabIndex={-1}
            disabled={!heldItem}
            onClick={(e) => {
              e.currentTarget.blur();
              onUseItem();
            }}
            className={`flex items-center gap-3 bg-[#0F172A]/90 border rounded-xl px-3.5 py-2.5 shadow-lg transition-colors ${
              heldItem
                ? 'border-amber-400/90 hover:bg-slate-800 cursor-pointer'
                : 'border-slate-700/80 opacity-85 cursor-default'
            }`}
          >
            <div className="w-10 h-10 rounded-lg bg-slate-900 border border-slate-700 flex items-center justify-center shrink-0">
              {heldItem ? (
                <ItemIconSvg type={heldItem} size={26} />
              ) : (
                <span className="text-slate-600 font-display font-bold text-lg">?</span>
              )}
            </div>
            <div className="text-left">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-slate-100 whitespace-nowrap">
                  {itemMeta ? itemMeta.name : 'Sem item'}
                </span>
                {heldItem && (
                  <span className="text-[10px] font-mono-num font-bold bg-amber-500 text-slate-950 px-1.5 py-0.5 rounded">
                    E
                  </span>
                )}
              </div>
              <div className="text-[11px] text-slate-400 whitespace-nowrap hidden sm:block">
                {itemMeta ? itemMeta.role : 'Colete caixas na pista'}
              </div>
            </div>
          </button>

          {/* Dash Gauge */}
          <button
            type="button"
            tabIndex={-1}
            disabled={!dashReady}
            onClick={(e) => {
              e.currentTarget.blur();
              onDash();
            }}
            className={`bg-[#0F172A]/90 border rounded-xl px-3 py-2.5 shadow-lg text-left transition-colors ${
              dashReady
                ? 'border-sky-400/80 hover:bg-slate-800 cursor-pointer'
                : 'border-slate-700/80 opacity-80 cursor-default'
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-bold text-slate-100">Dash</span>
              <span className="text-[10px] font-mono-num font-bold bg-sky-500 text-slate-950 px-1.5 py-0.5 rounded">
                Shift
              </span>
            </div>
            <div className="w-20 h-1.5 bg-slate-800 rounded-full overflow-hidden mt-2">
              <div
                className="h-full bg-sky-400"
                style={{ width: `${dashPct}%` }}
              />
            </div>
          </button>

          {/* Active Status Timers */}
          <div className="flex flex-col gap-1">
            {localRobot && (localRobot.jetpackTimer ?? 0) > 0 && (
              <div className="bg-orange-950/90 border border-orange-400 text-orange-200 text-xs font-mono-num font-semibold px-2.5 py-1 rounded-lg">
                Jetpack {localRobot.jetpackTimer.toFixed(1)}s · Segure Pular
              </div>
            )}
            {localRobot && localRobot.turboTimer > 0 && (
              <div className="bg-amber-950/90 border border-amber-500 text-amber-200 text-xs font-mono-num font-semibold px-2.5 py-1 rounded-lg">
                Turbo {localRobot.turboTimer.toFixed(1)}s
              </div>
            )}
            {localRobot && localRobot.shieldTimer > 0 && (
              <div className="bg-sky-950/90 border border-sky-500 text-sky-200 text-xs font-mono-num font-semibold px-2.5 py-1 rounded-lg">
                Escudo {localRobot.shieldTimer.toFixed(1)}s
              </div>
            )}
            {localRobot && localRobot.glitchTimer > 0 && (
              <div className="bg-pink-950/90 border border-pink-500 text-pink-200 text-xs font-mono-num font-semibold px-2.5 py-1 rounded-lg">
                Controles Invertidos {localRobot.glitchTimer.toFixed(1)}s
              </div>
            )}
            {localRobot && localRobot.frostTimer > 0 && (
              <div className="bg-cyan-950/90 border border-cyan-400 text-cyan-200 text-xs font-mono-num font-semibold px-2.5 py-1 rounded-lg">
                Congelado {localRobot.frostTimer.toFixed(1)}s
              </div>
            )}
            {localRobot && (localRobot.greaseTimer ?? 0) > 0 && (
              <div className="bg-lime-950/90 border border-lime-500 text-lime-200 text-xs font-mono-num font-semibold px-2.5 py-1 rounded-lg">
                Graxa {localRobot.greaseTimer.toFixed(1)}s
              </div>
            )}
            {localRobot && localRobot.empSlowTimer > 0 && (
              <div className="bg-rose-950/90 border border-rose-500 text-rose-200 text-xs font-mono-num font-semibold px-2.5 py-1 rounded-lg">
                EMP {localRobot.empSlowTimer.toFixed(1)}s
              </div>
            )}
          </div>
        </div>

        {/* Bottom-Right Desktop: Real-Time 2D Stage Minimap Radar */}
        <div className="hidden md:block">
          <MiniMapRadar
            stage={stage}
            robots={robots}
            localPlayerId={localPlayerId}
            cameraZoom={previewCamera ? previewCamera.zoom : cameraZoom}
            previewCamera={previewCamera}
            gamepadConnected={gamepadConnected}
            onCycleZoom={onCycleZoom}
            onZoomIn={onZoomIn}
            onZoomOut={onZoomOut}
          />
        </div>

        {/* Mobile Touch Controls */}
        <div className="flex md:hidden items-center gap-2 pointer-events-auto">
          <button
            type="button"
            aria-label="Mover para esquerda"
            onPointerDown={() => onTouchControl('left', true)}
            onPointerUp={() => onTouchControl('left', false)}
            onPointerCancel={() => onTouchControl('left', false)}
            onPointerLeave={() => onTouchControl('left', false)}
            className="w-12 h-12 rounded-xl bg-slate-900/90 border border-slate-700 text-slate-100 font-bold text-lg active:bg-slate-700"
          >
            ◀
          </button>
          <button
            type="button"
            aria-label="Mover para direita"
            onPointerDown={() => onTouchControl('right', true)}
            onPointerUp={() => onTouchControl('right', false)}
            onPointerCancel={() => onTouchControl('right', false)}
            onPointerLeave={() => onTouchControl('right', false)}
            className="w-12 h-12 rounded-xl bg-slate-900/90 border border-slate-700 text-slate-100 font-bold text-lg active:bg-slate-700"
          >
            ▶
          </button>
          <button
            type="button"
            aria-label="Pular"
            onPointerDown={() => onTouchControl('jump', true)}
            onPointerUp={() => onTouchControl('jump', false)}
            onPointerCancel={() => onTouchControl('jump', false)}
            onPointerLeave={() => onTouchControl('jump', false)}
            className="px-4 h-12 rounded-xl bg-amber-500 text-slate-950 font-display font-bold text-sm active:bg-amber-400"
          >
            Pular
          </button>
        </div>
      </div>
    </div>
  );
}
