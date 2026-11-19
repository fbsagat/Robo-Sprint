import React, { useState } from 'react';
import {
  ALL_ITEM_TYPES,
  DEFAULT_MATCH_SETTINGS,
  ITEM_METADATA,
  MAX_PLAYERS_PER_ROOM,
  ROBOT_CLASSES,
  ROBOT_PALETTES,
} from '../game/constants';
import type {
  BiomeId,
  GameMode,
  MatchSettings,
  RobotClassId,
  RobotState,
  RoomSummary,
} from '../game/types';
import { ItemIconSvg, RoboSprintEmblem, RobotAvatarSvg } from './Icons';

interface TitleLobbyProps {
  mode: 'title' | 'lobby';
  connected: boolean;
  playerId: string;
  playerName: string;
  colorIndex: number;
  robotClass: RobotClassId;
  gameMode: GameMode;
  matchSettings: MatchSettings;
  onChangeName: (name: string) => void;
  onChangeColor: (idx: number) => void;
  onChangeClass: (cls: RobotClassId) => void;
  onQuickStart: () => void;
  onStartEditorMode: () => void;
  onCreateRoom: () => void;
  onJoinRoom: (code: string) => void;
  openRooms: RoomSummary[];
  roomCode: string | null;
  hostId: string | null;
  botCount: number;
  robots: RobotState[];
  onSetBotCount: (count: number) => void;
  onSetGameMode: (mode: GameMode) => void;
  onUpdateMatchSettings: (patch: Partial<MatchSettings>) => void;
  onStartRace: () => void;
  onLeaveRoom: () => void;
  errorMsg: string | null;
  onClearError: () => void;
}

export function TitleLobby({
  mode,
  connected,
  playerId,
  playerName,
  colorIndex,
  robotClass,
  gameMode,
  matchSettings = DEFAULT_MATCH_SETTINGS,
  onChangeName,
  onChangeColor,
  onChangeClass,
  onQuickStart,
  onStartEditorMode,
  onCreateRoom,
  onJoinRoom,
  openRooms,
  roomCode,
  hostId,
  botCount,
  robots,
  onSetBotCount,
  onSetGameMode,
  onUpdateMatchSettings,
  onStartRace,
  onLeaveRoom,
  errorMsg,
  onClearError,
}: TitleLobbyProps) {
  const [joinCode, setJoinCode] = useState('');
  const [copied, setCopied] = useState(false);

  const isHost = hostId === playerId;
  const humanCount = robots.filter((r) => !r.isBot).length;
  const maxBots = Math.max(0, MAX_PLAYERS_PER_ROOM - Math.max(1, humanCount));
  const totalRacers = robots.length;

  const handleCopyInvite = () => {
    if (!roomCode) return;
    const url = `${window.location.origin}/?room=${roomCode}`;
    navigator.clipboard?.writeText(url).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className="fixed inset-0 z-20 flex flex-col justify-between p-4 sm:p-6 lg:p-8 pointer-events-none">
      <div className="flex-1 flex items-center">
        <div
          className={`w-full ${
            mode === 'lobby' ? 'max-w-2xl' : 'max-w-xl'
          } bg-[#0F172A]/94 border border-slate-700/80 rounded-2xl p-5 sm:p-6 shadow-2xl pointer-events-auto`}
        >
          <RoboSprintEmblem />

          {errorMsg && (
            <div
              role="alert"
              className="mt-4 flex items-center justify-between gap-3 bg-red-950/90 border border-red-700/80 text-red-100 text-sm px-4 py-2.5 rounded-lg"
            >
              <span>{errorMsg}</span>
              <button
                type="button"
                onClick={onClearError}
                className="text-xs font-semibold text-red-200 hover:text-white underline shrink-0"
              >
                Fechar
              </button>
            </div>
          )}

          {mode === 'title' ? (
            <div className="mt-5 space-y-4">
              {/* Robot Name & Color */}
              <div className="space-y-3">
                <div className="flex items-center gap-3.5">
                  <div className="w-13 h-13 rounded-xl bg-slate-900 border border-slate-700/90 flex items-center justify-center shrink-0 shadow-inner">
                    <RobotAvatarSvg colorIndex={colorIndex} robotClass={robotClass} size={42} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <label
                      htmlFor="player-name-input"
                      className="block text-xs font-medium text-slate-300 mb-1"
                    >
                      Nome do seu robô
                    </label>
                    <input
                      id="player-name-input"
                      type="text"
                      maxLength={14}
                      value={playerName}
                      onChange={(e) => onChangeName(e.target.value)}
                      placeholder="Ex: Volt-07"
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-amber-400"
                    />
                  </div>
                </div>

                <div>
                  <span className="block text-xs font-medium text-slate-300 mb-1.5">
                    Cor do chassi · <span className="text-slate-100 font-semibold">{ROBOT_PALETTES[colorIndex % ROBOT_PALETTES.length].name}</span>
                  </span>
                  <div className="flex flex-wrap gap-2">
                    {ROBOT_PALETTES.map((pal, idx) => (
                      <button
                        key={pal.id}
                        type="button"
                        aria-label={`Selecionar cor ${pal.name}`}
                        aria-pressed={colorIndex === idx}
                        onClick={() => onChangeColor(idx)}
                        className={`w-7 h-7 rounded-md border-2 transition-transform cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white ${
                          colorIndex === idx
                            ? 'border-white scale-110 shadow-md'
                            : 'border-slate-800 opacity-80 hover:opacity-100'
                        }`}
                        style={{ backgroundColor: pal.body }}
                      />
                    ))}
                  </div>
                </div>

                {/* Robot Class Selector */}
                <div>
                  <span className="block text-xs font-medium text-slate-300 mb-1.5">
                    Modelo do robô
                  </span>
                  <div className="grid grid-cols-3 gap-2">
                    {(['balanced', 'speedster', 'jumper'] as RobotClassId[]).map((clsId) => {
                      const cls = ROBOT_CLASSES[clsId];
                      const active = robotClass === clsId;
                      const spdBars = clsId === 'speedster' ? 3 : clsId === 'balanced' ? 2 : 1;
                      const jmpBars = clsId === 'jumper' ? 3 : clsId === 'balanced' ? 2 : 1;
                      return (
                        <button
                          key={clsId}
                          type="button"
                          aria-pressed={active}
                          onClick={() => onChangeClass(clsId)}
                          className={`text-left rounded-xl px-2.5 py-2 border transition-colors cursor-pointer ${
                            active
                              ? 'bg-slate-800/95 border-amber-400 text-slate-50 shadow-sm'
                              : 'bg-slate-900/80 border-slate-800 text-slate-300 hover:border-slate-600'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-1.5">
                            <span className="text-xs font-bold truncate">{cls.name}</span>
                            <RobotAvatarSvg colorIndex={colorIndex} robotClass={clsId} size={20} />
                          </div>
                          <div className="text-[10px] text-slate-400 leading-tight mt-0.5 truncate">
                            {cls.tagline}
                          </div>
                          <div className="mt-1.5 flex items-center gap-2 text-[9px] text-slate-400 font-mono-num">
                            <span className="flex items-center gap-0.5" title="Velocidade">
                              VEL
                              {[1, 2, 3].map((b) => (
                                <span
                                  key={b}
                                  className={`w-1.5 h-1.5 rounded-xs ${
                                    b <= spdBars ? 'bg-sky-400' : 'bg-slate-700'
                                  }`}
                                />
                              ))}
                            </span>
                            <span className="flex items-center gap-0.5" title="Impulsão">
                              PUL
                              {[1, 2, 3].map((b) => (
                                <span
                                  key={b}
                                  className={`w-1.5 h-1.5 rounded-xs ${
                                    b <= jmpBars ? 'bg-amber-400' : 'bg-slate-700'
                                  }`}
                                />
                              ))}
                            </span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Primary CTA + Editor Mode + Multiplayer Room Actions */}
              <div className="pt-1 space-y-2.5">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    data-start="true"
                    disabled={!connected}
                    onClick={onQuickStart}
                    className="w-full bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 font-display font-bold text-base py-2.5 px-4 rounded-xl transition-colors cursor-pointer whitespace-nowrap"
                  >
                    {connected ? 'Corrida Rápida' : 'Conectando...'}
                  </button>
                  <button
                    type="button"
                    data-testid="start-editor-mode-btn"
                    disabled={!connected}
                    onClick={onStartEditorMode}
                    className="w-full bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 font-display font-bold text-sm py-2.5 px-4 rounded-xl transition-colors cursor-pointer whitespace-nowrap"
                  >
                    Modo Editor (Criar & Competir)
                  </button>
                </div>

                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={!connected}
                    onClick={onCreateRoom}
                    className="bg-slate-800 hover:bg-slate-700 disabled:opacity-50 border border-slate-600 text-slate-100 font-semibold text-xs py-2 px-3.5 rounded-lg transition-colors cursor-pointer whitespace-nowrap"
                  >
                    Criar Sala (2–10 Jogadores)
                  </button>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (joinCode.trim().length > 0) {
                        onJoinRoom(joinCode.trim().toUpperCase());
                      }
                    }}
                    className="flex flex-1 gap-2"
                  >
                    <label htmlFor="room-code-input" className="sr-only">
                      Código da sala
                    </label>
                    <input
                      id="room-code-input"
                      type="text"
                      maxLength={6}
                      value={joinCode}
                      onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                      placeholder="Código da sala (ex: A7K2)"
                      className="flex-1 min-w-0 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-100 font-mono-num uppercase placeholder:normal-case focus:outline-none focus:ring-2 focus:ring-sky-400"
                    />
                    <button
                      type="submit"
                      disabled={!connected || joinCode.trim().length === 0}
                      className="bg-sky-600 hover:bg-sky-500 disabled:opacity-45 text-white font-semibold text-xs px-3.5 py-2 rounded-lg transition-colors cursor-pointer whitespace-nowrap"
                    >
                      Entrar
                    </button>
                  </form>
                </div>
              </div>

              {openRooms.length > 0 && (
                <div className="pt-2 border-t border-slate-800">
                  <div className="text-xs font-medium text-slate-400 mb-1.5">
                    Salas abertas agora
                  </div>
                  <div className="space-y-1.5 max-h-24 overflow-y-auto pr-1">
                    {openRooms.map((r) => (
                      <div
                        key={r.code}
                        className="flex items-center justify-between bg-slate-900/80 border border-slate-800 rounded-lg px-3 py-1.5 text-xs"
                      >
                        <div className="text-slate-200 truncate">
                          <span className="font-mono-num font-bold text-amber-400">{r.code}</span>
                          <span className="mx-1.5 text-slate-600">·</span>
                          <span>{r.hostName}</span>
                          <span className="mx-1.5 text-slate-600">·</span>
                          <span className="text-emerald-400 font-semibold">
                            {r.gameMode === 'editor' ? 'Modo Editor' : 'Procedural'}
                          </span>
                          <span className="mx-1.5 text-slate-600">·</span>
                          <span className="font-mono-num text-slate-400">
                            {r.humanCount + r.botCount}/{r.maxPlayers}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => onJoinRoom(r.code)}
                          className="ml-2 text-sky-400 hover:text-sky-300 font-semibold whitespace-nowrap cursor-pointer"
                        >
                          Entrar
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Compact 12-Item Legend */}
              <div className="pt-2 border-t border-slate-800 grid grid-cols-4 gap-2">
                {ALL_ITEM_TYPES.map((t) => (
                  <div
                    key={t}
                    title={`${ITEM_METADATA[t].name}: ${ITEM_METADATA[t].role}`}
                    className="flex items-center gap-1.5 text-[11px] text-slate-300 truncate"
                  >
                    <ItemIconSvg type={t} size={16} />
                    <span className="truncate">{ITEM_METADATA[t].name.split(' ')[0]}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-900 border border-slate-700/80 rounded-xl px-3.5 py-2.5">
                <div>
                  <div className="text-xs text-slate-400">
                    Código da sala ·{' '}
                    <span className="text-emerald-400 font-semibold">
                      {gameMode === 'editor' ? 'Modo Editor de Mapas' : 'Corrida Procedural'}
                    </span>
                  </div>
                  <div className="font-mono-num text-xl sm:text-2xl font-bold tracking-wider text-amber-400">
                    {roomCode}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleCopyInvite}
                    className="bg-slate-800 hover:bg-slate-700 border border-slate-600 text-slate-100 text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors cursor-pointer whitespace-nowrap"
                  >
                    {copied ? 'Link copiado' : 'Copiar link'}
                  </button>
                  <button
                    type="button"
                    onClick={onLeaveRoom}
                    className="bg-slate-800 hover:bg-red-900/70 border border-slate-700 text-slate-300 hover:text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors cursor-pointer whitespace-nowrap"
                  >
                    Sair
                  </button>
                </div>
              </div>

              {/* Game Mode Selector in Lobby */}
              <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-2.5">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs font-semibold text-slate-300">
                    Modo da Partida
                  </span>
                  {isHost && (
                    <span className="text-[10px] font-bold text-amber-400 uppercase tracking-wider">
                      Master da Partida
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    data-testid="lobby-mode-classic-btn"
                    disabled={!isHost}
                    onClick={() => onSetGameMode('classic')}
                    className={`rounded-lg px-3 py-1.5 text-left border transition-colors cursor-pointer ${
                      gameMode === 'classic'
                        ? 'bg-amber-500/20 border-amber-400 text-white'
                        : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <div className="text-xs font-bold">Corrida Procedural</div>
                    <div className="text-[10px] text-slate-400">
                      Fases dinâmicas em formato S
                    </div>
                  </button>
                  <button
                    type="button"
                    data-testid="lobby-mode-editor-btn"
                    disabled={!isHost}
                    onClick={() => onSetGameMode('editor')}
                    className={`rounded-lg px-3 py-1.5 text-left border transition-colors cursor-pointer ${
                      gameMode === 'editor'
                        ? 'bg-emerald-500/20 border-emerald-400 text-white'
                        : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <div className="text-xs font-bold">Modo Editor</div>
                    <div className="text-[10px] text-slate-400">
                      Criar, validar e competir em mapas próprios
                    </div>
                  </button>
                </div>
              </div>

              {/* MASTER MATCH SETTINGS PANEL (BOTH MODES) */}
              <div
                data-testid="master-match-settings-panel"
                className="bg-slate-900/85 border border-slate-700/85 rounded-xl p-3 space-y-2.5"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-amber-300">
                    Configurações da Partida ({gameMode === 'editor' ? 'Modo Editor' : 'Corrida Procedural'})
                  </span>
                  <span className="text-[10px] text-slate-400">
                    {isHost ? 'Ajuste as regras da sala' : 'Configurado pelo Master'}
                  </span>
                </div>

                {/* Common Match Settings Grid (Both Classic & Editor Modes) */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {/* Robot Speed Multiplier */}
                  <div className="bg-slate-950/75 border border-slate-800 rounded-lg px-2.5 py-1.5">
                    <div className="text-[10px] font-semibold text-slate-400 mb-1">
                      Velocidade dos Robôs
                    </div>
                    <div className="grid grid-cols-4 gap-1">
                      {(
                        [
                          { val: 0.8, label: '0.8x' },
                          { val: 1.0, label: '1.0x' },
                          { val: 1.25, label: '1.25x' },
                          { val: 1.5, label: '1.5x' },
                        ] as const
                      ).map((opt) => (
                        <button
                          key={opt.val}
                          type="button"
                          data-testid={`setting-speed-${opt.val}`}
                          disabled={!isHost}
                          onClick={() =>
                            onUpdateMatchSettings({ speedMultiplier: opt.val })
                          }
                          className={`text-[11px] font-mono-num font-bold py-1 rounded border transition-colors cursor-pointer ${
                            matchSettings.speedMultiplier === opt.val
                              ? 'bg-amber-500/25 border-amber-400 text-amber-200'
                              : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                          } disabled:cursor-default`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Gravity Multiplier */}
                  <div className="bg-slate-950/75 border border-slate-800 rounded-lg px-2.5 py-1.5">
                    <div className="text-[10px] font-semibold text-slate-400 mb-1">
                      Gravidade da Pista
                    </div>
                    <div className="grid grid-cols-4 gap-1">
                      {(
                        [
                          { val: 0.65, label: 'Lunar' },
                          { val: 0.85, label: 'Leve' },
                          { val: 1.0, label: 'Normal' },
                          { val: 1.2, label: 'Alta' },
                        ] as const
                      ).map((opt) => (
                        <button
                          key={opt.val}
                          type="button"
                          data-testid={`setting-gravity-${opt.val}`}
                          disabled={!isHost}
                          onClick={() =>
                            onUpdateMatchSettings({ gravityMultiplier: opt.val })
                          }
                          className={`text-[11px] font-semibold py-1 rounded border transition-colors cursor-pointer ${
                            matchSettings.gravityMultiplier === opt.val
                              ? 'bg-sky-500/25 border-sky-400 text-sky-200 font-bold'
                              : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                          } disabled:cursor-default`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Item Boxes Frequency */}
                  <div className="bg-slate-950/75 border border-slate-800 rounded-lg px-2.5 py-1.5">
                    <div className="text-[10px] font-semibold text-slate-400 mb-1">
                      Caixas de Itens
                    </div>
                    <div className="grid grid-cols-3 gap-1">
                      {(
                        [
                          { val: 'none', label: 'Sem Itens' },
                          { val: 'normal', label: 'Normal' },
                          { val: 'frenzy', label: 'Frenesi' },
                        ] as const
                      ).map((opt) => (
                        <button
                          key={opt.val}
                          type="button"
                          data-testid={`setting-items-${opt.val}`}
                          disabled={!isHost}
                          onClick={() =>
                            onUpdateMatchSettings({ itemFrequency: opt.val })
                          }
                          className={`text-[11px] font-semibold py-1 rounded border transition-colors cursor-pointer ${
                            matchSettings.itemFrequency === opt.val
                              ? 'bg-amber-500/25 border-amber-400 text-amber-200 font-bold'
                              : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                          } disabled:cursor-default`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Hazards & Bot Difficulty */}
                  <div className="bg-slate-950/75 border border-slate-800 rounded-lg px-2.5 py-1.5 flex items-center justify-between gap-2">
                    <div className="flex-1">
                      <div className="text-[10px] font-semibold text-slate-400 mb-1">
                        Perigos da Pista
                      </div>
                      <button
                        type="button"
                        data-testid="setting-hazards-toggle"
                        disabled={!isHost}
                        onClick={() =>
                          onUpdateMatchSettings({
                            hazardsEnabled: !matchSettings.hazardsEnabled,
                          })
                        }
                        className={`w-full text-[11px] font-bold py-1 px-2 rounded border transition-colors cursor-pointer ${
                          matchSettings.hazardsEnabled
                            ? 'bg-emerald-500/20 border-emerald-400 text-emerald-300'
                            : 'bg-red-500/20 border-red-400 text-red-300'
                        } disabled:cursor-default`}
                      >
                        {matchSettings.hazardsEnabled ? 'Ativos' : 'Desativados'}
                      </button>
                    </div>

                    <div className="flex-1">
                      <div className="text-[10px] font-semibold text-slate-400 mb-1">
                        Nível da IA
                      </div>
                      <div className="grid grid-cols-3 gap-1">
                        {(
                          [
                            { val: 'casual', label: 'Fácil' },
                            { val: 'normal', label: 'Médio' },
                            { val: 'pro', label: 'Pro' },
                          ] as const
                        ).map((opt) => (
                          <button
                            key={opt.val}
                            type="button"
                            data-testid={`setting-botdiff-${opt.val}`}
                            disabled={!isHost}
                            onClick={() =>
                              onUpdateMatchSettings({ botDifficulty: opt.val })
                            }
                            className={`text-[10px] font-semibold py-1 rounded border transition-colors cursor-pointer ${
                              matchSettings.botDifficulty === opt.val
                                ? 'bg-sky-500/25 border-sky-400 text-sky-200 font-bold'
                                : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                            } disabled:cursor-default`}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Mode-Specific Settings Row */}
                {gameMode === 'classic' ? (
                  <div
                    data-testid="classic-mode-settings"
                    className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1.5 border-t border-slate-800"
                  >
                    {/* Procedural Stage Length */}
                    <div className="bg-slate-950/75 border border-slate-800 rounded-lg px-2.5 py-1.5">
                      <div className="text-[10px] font-semibold text-slate-400 mb-1">
                        Tamanho da Fase
                      </div>
                      <div className="grid grid-cols-3 gap-1">
                        {(
                          [
                            { val: 'short', label: 'Curta' },
                            { val: 'standard', label: 'Padrão' },
                            { val: 'long', label: 'Longa' },
                          ] as const
                        ).map((opt) => (
                          <button
                            key={opt.val}
                            type="button"
                            data-testid={`setting-length-${opt.val}`}
                            disabled={!isHost}
                            onClick={() =>
                              onUpdateMatchSettings({ classicStageLength: opt.val })
                            }
                            className={`text-[11px] font-semibold py-1 rounded border transition-colors cursor-pointer ${
                              matchSettings.classicStageLength === opt.val
                                ? 'bg-amber-500/25 border-amber-400 text-amber-200 font-bold'
                                : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                            } disabled:cursor-default`}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Biome Selector */}
                    <div className="bg-slate-950/75 border border-slate-800 rounded-lg px-2.5 py-1.5">
                      <div className="text-[10px] font-semibold text-slate-400 mb-1">
                        Bioma da Pista
                      </div>
                      <div className="grid grid-cols-4 gap-1">
                        {(
                          [
                            { val: 'auto', label: 'Auto' },
                            { val: 'foundry', label: 'Forja' },
                            { val: 'wind_tower', label: 'Eólica' },
                            { val: 'orbital_core', label: 'Orbital' },
                          ] as Array<{ val: 'auto' | BiomeId; label: string }>
                        ).map((opt) => (
                          <button
                            key={opt.val}
                            type="button"
                            data-testid={`setting-biome-${opt.val}`}
                            disabled={!isHost}
                            onClick={() =>
                              onUpdateMatchSettings({ classicBiome: opt.val })
                            }
                            className={`text-[10px] font-semibold py-1 rounded border transition-colors cursor-pointer ${
                              matchSettings.classicBiome === opt.val
                                ? 'bg-sky-500/25 border-sky-400 text-sky-200 font-bold'
                                : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                            } disabled:cursor-default`}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Tournament Stage Goal */}
                    <div className="bg-slate-950/75 border border-slate-800 rounded-lg px-2.5 py-1.5">
                      <div className="text-[10px] font-semibold text-slate-400 mb-1">
                        Duração da Copa
                      </div>
                      <div className="grid grid-cols-4 gap-1">
                        {(
                          [
                            { val: 0, label: 'Livre' },
                            { val: 3, label: '3 Fases' },
                            { val: 5, label: '5 Fases' },
                            { val: 10, label: '10 Fases' },
                          ] as const
                        ).map((opt) => (
                          <button
                            key={opt.val}
                            type="button"
                            data-testid={`setting-stages-${opt.val}`}
                            disabled={!isHost}
                            onClick={() =>
                              onUpdateMatchSettings({ classicTargetStages: opt.val })
                            }
                            className={`text-[10px] font-semibold py-1 rounded border transition-colors cursor-pointer ${
                              matchSettings.classicTargetStages === opt.val
                                ? 'bg-emerald-500/25 border-emerald-400 text-emerald-200 font-bold'
                                : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                            } disabled:cursor-default`}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div
                    data-testid="editor-mode-settings"
                    className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1.5 border-t border-slate-800"
                  >
                    {/* Editor Build Time Limit */}
                    <div className="bg-slate-950/75 border border-slate-800 rounded-lg px-2.5 py-1.5">
                      <div className="text-[10px] font-semibold text-slate-400 mb-1">
                        Tempo de Criação
                      </div>
                      <div className="grid grid-cols-4 gap-1">
                        {(
                          [
                            { val: 60, label: '60s' },
                            { val: 120, label: '120s' },
                            { val: 180, label: '180s' },
                            { val: 300, label: '300s' },
                          ] as const
                        ).map((opt) => (
                          <button
                            key={opt.val}
                            type="button"
                            data-testid={`setting-buildtime-${opt.val}`}
                            disabled={!isHost}
                            onClick={() =>
                              onUpdateMatchSettings({ editorBuildTimeLimit: opt.val })
                            }
                            className={`text-[11px] font-mono-num font-bold py-1 rounded border transition-colors cursor-pointer ${
                              matchSettings.editorBuildTimeLimit === opt.val
                                ? 'bg-emerald-500/25 border-emerald-400 text-emerald-200'
                                : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                            } disabled:cursor-default`}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Editor Course Time Limit */}
                    <div className="bg-slate-950/75 border border-slate-800 rounded-lg px-2.5 py-1.5">
                      <div className="text-[10px] font-semibold text-slate-400 mb-1">
                        Tempo do Percurso
                      </div>
                      <div className="grid grid-cols-4 gap-1">
                        {(
                          [
                            { val: 30, label: '30s' },
                            { val: 45, label: '45s' },
                            { val: 60, label: '60s' },
                            { val: 90, label: '90s' },
                          ] as const
                        ).map((opt) => (
                          <button
                            key={opt.val}
                            type="button"
                            data-testid={`setting-coursetime-${opt.val}`}
                            disabled={!isHost}
                            onClick={() =>
                              onUpdateMatchSettings({ editorCourseTimeLimit: opt.val })
                            }
                            className={`text-[11px] font-mono-num font-bold py-1 rounded border transition-colors cursor-pointer ${
                              matchSettings.editorCourseTimeLimit === opt.val
                                ? 'bg-amber-500/25 border-amber-400 text-amber-200'
                                : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                            } disabled:cursor-default`}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Pre-Match Map Observation Duration */}
                    <div className="bg-slate-950/75 border border-slate-800 rounded-lg px-2.5 py-1.5">
                      <div className="text-[10px] font-semibold text-slate-400 mb-1">
                        Observação Pré-Mapa
                      </div>
                      <div className="grid grid-cols-4 gap-1">
                        {(
                          [
                            { val: 0, label: '0s' },
                            { val: 5, label: '5s' },
                            { val: 8, label: '8s' },
                            { val: 12, label: '12s' },
                          ] as const
                        ).map((opt) => (
                          <button
                            key={opt.val}
                            type="button"
                            data-testid={`setting-previewtime-${opt.val}`}
                            disabled={!isHost}
                            onClick={() =>
                              onUpdateMatchSettings({ editorPreviewSeconds: opt.val })
                            }
                            className={`text-[11px] font-mono-num font-bold py-1 rounded border transition-colors cursor-pointer ${
                              matchSettings.editorPreviewSeconds === opt.val
                                ? 'bg-sky-500/25 border-sky-400 text-sky-200'
                                : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                            } disabled:cursor-default`}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div>
                <div className="flex items-center justify-between text-xs text-slate-300 mb-1.5">
                  <span>Competidores na pista</span>
                  <span className="font-mono-num text-slate-400">
                    {totalRacers} / {MAX_PLAYERS_PER_ROOM}
                  </span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                  {robots.map((r) => (
                    <div
                      key={r.id}
                      className="flex items-center gap-2 bg-slate-900/90 border border-slate-800 rounded-lg px-2.5 py-1.5"
                    >
                      <RobotAvatarSvg colorIndex={r.colorIndex} size={24} />
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-semibold text-slate-100 truncate">
                          {r.name}
                        </div>
                        <div className="text-[10px] text-slate-400 truncate">
                          {r.id === hostId
                            ? 'Master'
                            : r.isBot
                            ? 'Robô IA'
                            : r.id === playerId
                            ? 'Você'
                            : 'Jogador'}
                          {' · '}
                          {ROBOT_CLASSES[r.robotClass]?.name.split(' ')[0] ?? 'Mk-II'}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {isHost && (
                <div className="flex items-center justify-between gap-4 bg-slate-900/70 border border-slate-800 rounded-xl px-3.5 py-2">
                  <div>
                    <div className="text-xs font-semibold text-slate-200">
                      Robôs IA de treino
                    </div>
                    <div className="text-[11px] text-slate-400">
                      Opcional para preencher vagas até {MAX_PLAYERS_PER_ROOM} robôs
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      aria-label="Diminuir robôs IA"
                      disabled={botCount <= 0}
                      onClick={() => onSetBotCount(Math.max(0, botCount - 1))}
                      className="w-7 h-7 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-100 font-bold cursor-pointer"
                    >
                      -
                    </button>
                    <span className="font-mono-num text-sm font-bold w-6 text-center text-amber-400">
                      {botCount}
                    </span>
                    <button
                      type="button"
                      aria-label="Aumentar robôs IA"
                      disabled={botCount >= maxBots}
                      onClick={() => onSetBotCount(Math.min(maxBots, botCount + 1))}
                      className="w-7 h-7 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-100 font-bold cursor-pointer"
                    >
                      +
                    </button>
                  </div>
                </div>
              )}

              {isHost ? (
                <button
                  type="button"
                  data-start="true"
                  disabled={totalRacers < 2}
                  onClick={onStartRace}
                  className={`w-full font-display font-bold text-base py-2.5 px-4 rounded-xl transition-colors cursor-pointer ${
                    gameMode === 'editor'
                      ? 'bg-emerald-500 hover:bg-emerald-400 text-slate-950'
                      : 'bg-amber-500 hover:bg-amber-400 text-slate-950'
                  } disabled:opacity-45`}
                >
                  {totalRacers < 2
                    ? 'Aguardando 2º competidor (ou adicione 1 Robô IA)'
                    : gameMode === 'editor'
                    ? 'Iniciar Modo Editor (Criar Mapas)'
                    : 'Iniciar Corrida'}
                </button>
              ) : (
                <div className="text-center text-sm text-slate-300 py-2">
                  Aguardando o Master iniciar a partida...
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="text-center text-xs text-slate-300/90 tracking-wide">
        Teclado ou Gamepad · A/D, Setas ou Analógico: Mover · Espaço/A: Pular · Shift/RB: Dash · E/Y: Item · Roda do Mouse/Z: Zoom
      </div>
    </div>
  );
}
