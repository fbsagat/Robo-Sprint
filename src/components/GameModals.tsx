import React from 'react';
import type { EditorModeState, GameMode, RobotState, StageData } from '../game/types';
import { RobotAvatarSvg } from './Icons';

interface PauseModalProps {
  stageNumber: number;
  onResume: () => void;
  onLeaveToLobby: () => void;
}

export function PauseModal({
  stageNumber,
  onResume,
  onLeaveToLobby,
}: PauseModalProps) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="pause-title"
      className="fixed inset-0 z-30 flex items-center justify-center bg-[#060A12]/72 p-4"
    >
      <div className="w-full max-w-sm bg-[#0F172A] border border-slate-700 rounded-2xl p-6 shadow-2xl text-center">
        <div className="text-xs font-semibold text-amber-400">Fase {stageNumber}</div>
        <h2 id="pause-title" className="font-display text-2xl font-bold text-white mt-1">
          Corrida Pausada
        </h2>
        <p className="text-sm text-slate-400 mt-1.5">
          Em partidas multiplayer a pista continua em tempo real no servidor.
        </p>

        <div className="mt-6 space-y-2.5">
          <button
            type="button"
            onClick={onResume}
            className="w-full bg-amber-500 hover:bg-amber-400 text-slate-950 font-display font-bold py-2.5 px-4 rounded-xl transition-colors cursor-pointer"
          >
            Continuar
          </button>
          <button
            type="button"
            onClick={onLeaveToLobby}
            className="w-full bg-slate-800 hover:bg-slate-700 border border-slate-600 text-slate-200 font-semibold text-sm py-2.5 px-4 rounded-xl transition-colors cursor-pointer"
          >
            Sair para o Lobby
          </button>
        </div>
      </div>
    </div>
  );
}

interface PodiumModalProps {
  stage: StageData;
  robots: RobotState[];
  localPlayerId: string;
  isHost: boolean;
  gameMode?: GameMode;
  matchSettings?: import('../game/types').MatchSettings;
  editorState?: EditorModeState;
  onNextStage: () => void;
  onRestartEditorCycle?: () => void;
  onReturnLobby: () => void;
}

export function PodiumModal({
  stage,
  robots,
  localPlayerId,
  isHost,
  gameMode,
  matchSettings,
  editorState,
  onNextStage,
  onRestartEditorCycle,
  onReturnLobby,
}: PodiumModalProps) {
  const isEditorMode = gameMode === 'editor' && Boolean(editorState);
  const classicTargetStages = matchSettings?.classicTargetStages ?? 0;
  const isClassicTournamentFinal =
    !isEditorMode && classicTargetStages > 0 && stage.stageNumber >= classicTargetStages;
  const isFinal = Boolean(
    (isEditorMode && editorState?.isTournamentFinal) || isClassicTournamentFinal
  );

  // Round standings (sorted by finishRank on the map just played)
  const roundStandings = [...robots].sort((a, b) => {
    const rankA = a.finishRank ?? 999;
    const rankB = b.finishRank ?? 999;
    if (rankA !== rankB) return rankA - rankB;
    return b.progress - a.progress;
  });

  // Overall tournament standings (sorted by cumulative score across all maps)
  const tournamentStandings = [...robots].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const rankA = a.finishRank ?? 999;
    const rankB = b.finishRank ?? 999;
    return rankA - rankB;
  });

  const displayStandings = isFinal ? tournamentStandings : roundStandings;
  const roundWinner = roundStandings[0];
  const roundLastPlace =
    roundStandings.length > 1 ? roundStandings[roundStandings.length - 1] : null;
  const tournamentChampion = tournamentStandings[0];

  const localRank = Math.max(
    1,
    displayStandings.findIndex((r) => r.id === localPlayerId) + 1
  );
  const localRobot = displayStandings.find((r) => r.id === localPlayerId);
  const won = localRank === 1;
  const useTwoColStandings = displayStandings.length > 5;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="podium-title"
      className="fixed inset-0 z-30 flex items-center justify-center bg-[#060A12]/82 p-3 sm:p-4"
    >
      <div
        data-testid="victory-podium-card"
        className="w-full max-w-2xl bg-[#0F172A] border border-slate-700 rounded-2xl p-4 sm:p-5 shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-xs font-semibold text-amber-400">
              {isEditorMode && editorState
                ? isFinal
                  ? `Torneio do Modo Editor Concluído (${editorState.totalMaps} Mapas Jogados)`
                  : `Mapa ${editorState.currentMapIndex + 1} de ${editorState.totalMaps} · Criado por ${editorState.currentMapCreatorName ?? 'Criador'}`
                : isClassicTournamentFinal
                ? `Copa de ${classicTargetStages} Fases Concluída!`
                : classicTargetStages > 0
                ? `Fase ${stage.stageNumber} de ${classicTargetStages} concluída`
                : `Fase ${stage.stageNumber} concluída`}
            </div>
            <h2
              id="podium-title"
              className="font-display text-xl sm:text-2xl font-extrabold text-white mt-0.5"
            >
              {isFinal
                ? `Campeão: ${tournamentChampion?.name ?? 'Vencedor'}!`
                : won
                ? isEditorMode
                  ? 'Vitória no Mapa!'
                  : 'Vitória na Fase!'
                : `${localRank}º Lugar na Rodada`}
            </h2>
          </div>
          <div className="text-right">
            <div className="text-[11px] text-slate-400">
              {isEditorMode || isFinal ? 'Seus Pontos no Ranking' : 'Subida conquistada'}
            </div>
            <div className="font-mono-num text-base sm:text-lg font-bold text-emerald-400">
              {isEditorMode || isFinal
                ? `${localRobot?.score ?? 0} pts`
                : `+${Math.round(stage.targetClimb / 10)}m`}
            </div>
          </div>
        </div>

        {/* Editor Mode Rule Highlight: First Place Wins / Last Place Loses */}
        {isEditorMode && roundWinner && (
          <div className="mt-2.5 grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div className="bg-emerald-950/60 border border-emerald-500/60 rounded-xl px-3 py-2 flex items-center gap-2.5">
              <RobotAvatarSvg
                colorIndex={roundWinner.colorIndex}
                robotClass={roundWinner.robotClass}
                size={28}
              />
              <div className="min-w-0">
                <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-400">
                  1º a Chegar · Venceu o Mapa (+100 pts)
                </div>
                <div className="text-xs font-bold text-white truncate">
                  {roundWinner.name}
                  {roundWinner.id === editorState?.currentMapCreatorId && (
                    <span className="ml-1.5 text-[10px] text-amber-300 font-semibold">
                      (Criador do Mapa)
                    </span>
                  )}
                </div>
              </div>
            </div>

            {roundLastPlace && (
              <div className="bg-red-950/55 border border-red-500/50 rounded-xl px-3 py-2 flex items-center gap-2.5">
                <RobotAvatarSvg
                  colorIndex={roundLastPlace.colorIndex}
                  robotClass={roundLastPlace.robotClass}
                  size={28}
                />
                <div className="min-w-0">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-red-400">
                    Último a Chegar · Perdeu no Mapa (0 pts)
                  </div>
                  <div className="text-xs font-bold text-white truncate">
                    {roundLastPlace.name}
                    {roundLastPlace.id === editorState?.currentMapCreatorId && (
                      <span className="ml-1.5 text-[10px] text-amber-300 font-semibold">
                        (Criador do Mapa)
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Visual Top 3 Podium Pedestals */}
        {displayStandings.length >= 2 && (
          <div className="mt-2.5 pt-2.5 px-3 bg-slate-900/90 border border-slate-800 rounded-xl flex items-end justify-center gap-3">
            {[displayStandings[1], displayStandings[0], displayStandings[2]].map(
              (r, slotIdx) => {
                if (!r) return null;
                const place = slotIdx === 1 ? 1 : slotIdx === 0 ? 2 : 3;
                const heightClass =
                  place === 1 ? 'h-11' : place === 2 ? 'h-8' : 'h-7';
                const pedestalColor =
                  place === 1
                    ? 'bg-amber-500/20 border-amber-400/80 text-amber-300'
                    : place === 2
                    ? 'bg-slate-700/40 border-slate-400/70 text-slate-200'
                    : 'bg-orange-900/30 border-orange-500/60 text-orange-300';
                return (
                  <div
                    key={r.id}
                    className="flex flex-col items-center w-28 min-w-0"
                  >
                    <RobotAvatarSvg
                      colorIndex={r.colorIndex}
                      robotClass={r.robotClass}
                      size={place === 1 ? 32 : 26}
                    />
                    <div className="text-[11px] font-semibold text-slate-100 truncate max-w-full mt-0.5">
                      {r.name}
                    </div>
                    <div
                      className={`w-full ${heightClass} mt-1 rounded-t-lg border-t-2 border-x flex flex-col items-center justify-center font-mono-num font-bold text-xs ${pedestalColor}`}
                    >
                      <span>{place}º</span>
                    </div>
                  </div>
                );
              }
            )}
          </div>
        )}

        {/* Non-Scrolling Standings List (Auto 2-Column when > 5 players) */}
        <div
          data-testid="victory-standings-list"
          className={`mt-2.5 ${
            useTwoColStandings ? 'grid grid-cols-1 sm:grid-cols-2 gap-1.5' : 'space-y-1.5'
          }`}
        >
          {displayStandings.map((r, idx) => {
            const isMe = r.id === localPlayerId;
            const isCreator =
              isEditorMode && r.id === editorState?.currentMapCreatorId;
            const isLast =
              isEditorMode &&
              !isFinal &&
              displayStandings.length > 1 &&
              idx === displayStandings.length - 1;
            return (
              <div
                key={r.id}
                className={`flex items-center justify-between rounded-lg px-2.5 py-1.5 border text-xs sm:text-sm ${
                  isMe
                    ? 'bg-slate-800/95 border-amber-500/70 text-white'
                    : 'bg-slate-900/80 border-slate-800 text-slate-300'
                }`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className={`font-mono-num font-bold w-5 ${
                      idx === 0
                        ? 'text-amber-400'
                        : isLast
                        ? 'text-red-400'
                        : 'text-slate-400'
                    }`}
                  >
                    {idx + 1}º
                  </span>
                  <RobotAvatarSvg
                    colorIndex={r.colorIndex}
                    robotClass={r.robotClass}
                    size={22}
                  />
                  <span className="font-semibold truncate">{r.name}</span>
                  {isCreator && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 font-semibold">
                      Criador
                    </span>
                  )}
                  {idx === 0 && (isEditorMode || isFinal) && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-semibold">
                      {isFinal ? 'Campeão' : 'Venceu'}
                    </span>
                  )}
                  {isLast && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/20 text-red-300 font-semibold">
                      Perdeu
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2.5 font-mono-num text-xs shrink-0">
                  <span className="text-slate-400">
                    {r.finishTime !== null
                      ? `${r.finishTime.toFixed(2)}s`
                      : `${r.progress}%`}
                  </span>
                  <span className="font-bold text-emerald-400 w-13 text-right">
                    {r.score} pts
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Non-Scrolling Map History Summary in Final Tournament Ranking */}
        {isEditorMode && isFinal && editorState && editorState.roundResults.length > 0 && (
          <div className="mt-2.5 pt-2 border-t border-slate-800">
            <div className="text-[11px] font-semibold text-slate-400 mb-1.5">
              Resumo de Todos os Mapas Criados
            </div>
            <div
              data-testid="victory-map-history-grid"
              className={`grid gap-1.5 ${
                editorState.roundResults.length > 4
                  ? 'grid-cols-2 sm:grid-cols-3'
                  : 'grid-cols-1 sm:grid-cols-2'
              }`}
            >
              {editorState.roundResults.map((res) => (
                <div
                  key={res.mapIndex}
                  className="bg-slate-900/90 border border-slate-800 rounded-lg px-2.5 py-1 text-[11px] flex items-center justify-between gap-2"
                >
                  <span className="text-slate-300 truncate">
                    <strong className="text-amber-300">
                      Mapa {res.mapIndex + 1}
                    </strong>{' '}
                    ({res.creatorName})
                  </span>
                  <span className="shrink-0 font-mono-num">
                    <span className="text-emerald-400">1º {res.winnerName}</span>
                    {' · '}
                    <span className="text-red-400">Últ. {res.lastPlaceName}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="mt-3.5 flex flex-col sm:flex-row gap-2">
          {isHost ? (
            isEditorMode && editorState ? (
              isFinal ? (
                <button
                  type="button"
                  data-start="true"
                  data-testid="restart-editor-cycle-btn"
                  onClick={onRestartEditorCycle ?? onNextStage}
                  className="flex-1 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-display font-bold py-2.5 px-4 rounded-xl transition-colors cursor-pointer whitespace-nowrap"
                >
                  Nova Rodada do Modo Editor (Criar Novos Mapas)
                </button>
              ) : (
                <button
                  type="button"
                  data-start="true"
                  data-testid="next-editor-map-btn"
                  onClick={onNextStage}
                  className="flex-1 bg-amber-500 hover:bg-amber-400 text-slate-950 font-display font-bold py-2.5 px-4 rounded-xl transition-colors cursor-pointer whitespace-nowrap"
                >
                  Próximo Mapa Criado (Mapa {editorState.currentMapIndex + 2} de{' '}
                  {editorState.totalMaps})
                </button>
              )
            ) : (
              <button
                type="button"
                data-start="true"
                onClick={onNextStage}
                className="flex-1 bg-amber-500 hover:bg-amber-400 text-slate-950 font-display font-bold py-2.5 px-4 rounded-xl transition-colors cursor-pointer whitespace-nowrap"
              >
                {isClassicTournamentFinal
                  ? 'Nova Copa Procedural (Reiniciar Fase 1)'
                  : `Próxima Fase (Fase ${stage.stageNumber + 1})`}
              </button>
            )
          ) : (
            <div className="flex-1 text-center text-sm text-slate-300 py-2.5 bg-slate-900 border border-slate-800 rounded-xl">
              {isFinal
                ? 'Aguardando líder iniciar nova rodada...'
                : 'Aguardando líder avançar para a próxima etapa...'}
            </div>
          )}
          <button
            type="button"
            onClick={onReturnLobby}
            className="bg-slate-800 hover:bg-slate-700 border border-slate-600 text-slate-200 font-semibold text-sm py-2.5 px-4 rounded-xl transition-colors cursor-pointer whitespace-nowrap"
          >
            Lobby
          </button>
        </div>
      </div>
    </div>
  );
}
