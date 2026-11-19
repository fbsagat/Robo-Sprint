import React from 'react';
import { ROBOT_PALETTES } from '../game/constants';
import type { ItemType, RobotClassId } from '../game/types';

export function RoboSprintEmblem() {
  return (
    <div className="inline-flex items-center gap-4">
      <svg
        width="58"
        height="58"
        viewBox="0 0 58 58"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
        className="shrink-0"
      >
        <rect
          x="4"
          y="7"
          width="50"
          height="45"
          rx="13"
          fill="#0F172A"
          stroke="#F59E0B"
          strokeWidth="2.5"
        />
        <rect
          x="7"
          y="10"
          width="44"
          height="39"
          rx="10"
          fill="#1E293B"
        />
        {/* Speed wing fins */}
        <path d="M2 22L6 17V29L2 26V22Z" fill="#FB923C" />
        <path d="M56 22L52 17V29L56 26V22Z" fill="#FB923C" />
        {/* Antenna */}
        <line x1="29" y1="5" x2="29" y2="12" stroke="#CBD5E1" strokeWidth="2.5" />
        <circle cx="29" cy="4.5" r="3.5" fill="#FACC15" stroke="#0F172A" strokeWidth="1.5" />
        {/* Visor */}
        <rect x="13" y="17" width="32" height="17" rx="6" fill="#090D16" stroke="#38BDF8" strokeWidth="2" />
        <path d="M16 20H26L23 23H16V20Z" fill="#BAE6FD" fillOpacity="0.25" />
        <rect x="19" y="22.5" width="5.5" height="6.5" rx="1.8" fill="#38BDF8" />
        <rect x="33.5" y="22.5" width="5.5" height="6.5" rx="1.8" fill="#38BDF8" />
        {/* Chest power core */}
        <rect x="21" y="39" width="16" height="5" rx="2.5" fill="#F59E0B" />
        <circle cx="29" cy="41.5" r="1.8" fill="#FEF08A" />
      </svg>
      <div>
        <h1 className="font-display text-4xl sm:text-5xl font-bold tracking-tight text-slate-50 leading-none">
          Robo Sprint
        </h1>
        <p className="text-sm text-slate-300 mt-1.5">
          Corrida procedural de robôs · 2 a 10 jogadores
        </p>
      </div>
    </div>
  );
}

export function RobotAvatarSvg({
  colorIndex,
  robotClass = 'balanced',
  size = 36,
}: {
  colorIndex: number;
  robotClass?: RobotClassId;
  size?: number;
}) {
  const pal = ROBOT_PALETTES[colorIndex % ROBOT_PALETTES.length];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 36 36"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className="shrink-0"
    >
      {/* Class-specific silhouette attachments */}
      {robotClass === 'speedster' && (
        <>
          <path d="M2 14L7 11V21L2 18V14Z" fill={pal.accent} stroke="#0B1120" strokeWidth="1.4" />
          <path d="M34 14L29 11V21L34 18V14Z" fill={pal.accent} stroke="#0B1120" strokeWidth="1.4" />
        </>
      )}
      {robotClass === 'jumper' && (
        <>
          <rect x="3.5" y="10" width="4" height="10" rx="1.5" fill="#F59E0B" stroke="#0B1120" strokeWidth="1.4" />
          <rect x="28.5" y="10" width="4" height="10" rx="1.5" fill="#F59E0B" stroke="#0B1120" strokeWidth="1.4" />
        </>
      )}
      {robotClass === 'balanced' && (
        <>
          <rect x="4" y="14" width="3" height="7" rx="1.2" fill="#94A3B8" stroke="#0B1120" strokeWidth="1.3" />
          <rect x="29" y="14" width="3" height="7" rx="1.2" fill="#94A3B8" stroke="#0B1120" strokeWidth="1.3" />
        </>
      )}
      <line x1="18" y1="7" x2="18" y2="2.8" stroke="#CBD5E1" strokeWidth="2" strokeLinecap="round" />
      <circle cx="18" cy="2.8" r="2.3" fill={pal.accent} stroke="#0B1120" strokeWidth="1" />
      <rect
        x="6.5"
        y="7.5"
        width="23"
        height="21"
        rx="6"
        fill={pal.body}
        stroke="#0B1120"
        strokeWidth="2"
      />
      {/* Top chassis specular highlight */}
      <path d="M10 10H26" stroke="#FFFFFF" strokeOpacity="0.35" strokeWidth="1.6" strokeLinecap="round" />
      {/* Lower shade */}
      <rect x="8" y="23.5" width="20" height="4" rx="2" fill={pal.shade} />
      {/* Visor */}
      <rect x="10.5" y="12.5" width="15" height="8.5" rx="3" fill="#090D16" />
      <rect x="13.5" y="15" width="3.2" height="3.8" rx="0.9" fill={pal.visor} />
      <rect x="19.5" y="15" width="3.2" height="3.8" rx="0.9" fill={pal.visor} />
      {/* Treads / Legs */}
      <rect x="9" y="28.5" width="7" height="4.5" rx="1.5" fill="#1E293B" stroke="#0B1120" strokeWidth="1.5" />
      <rect x="20" y="28.5" width="7" height="4.5" rx="1.5" fill="#1E293B" stroke="#0B1120" strokeWidth="1.5" />
    </svg>
  );
}

export function ItemIconSvg({ type, size = 24 }: { type: ItemType; size?: number }) {
  switch (type) {
    case 'turbo':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M13 2L4 14H11L10 22L20 10H13L13 2Z"
            fill="#F59E0B"
            stroke="#0F172A"
            strokeWidth="1.8"
            strokeLinejoin="round"
          />
          <path d="M12.5 5.5L8 12H12.5L11.8 17.5L16.5 11.5H12.2L12.5 5.5Z" fill="#FEF08A" />
        </svg>
      );
    case 'shield':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M12 2.5L4.5 5.8V11.8C4.5 16.5 7.7 20.6 12 22C16.3 20.6 19.5 16.5 19.5 11.8V5.8L12 2.5Z"
            fill="#3B82F6"
            stroke="#0F172A"
            strokeWidth="1.8"
          />
          <path d="M12 5.2L7 7.4V11.6C7 14.9 9.1 17.8 12 19V5.2Z" fill="#93C5FD" />
        </svg>
      );
    case 'emp':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="12" cy="12" r="9.5" fill="#0E7490" stroke="#0F172A" strokeWidth="1.8" />
          <circle cx="12" cy="12" r="5.5" stroke="#67E8F9" strokeWidth="1.8" strokeDasharray="3 2" />
          <circle cx="12" cy="12" r="2.5" fill="#ECFEFF" />
        </svg>
      );
    case 'rocket':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M19.5 4.5C15 4.5 11.2 6.8 9 10.5L6.2 10L4 12.5L7.5 14.5L9.5 16.5L11.5 20L14 17.8L13.5 15C17.2 12.8 19.5 9 19.5 4.5Z"
            fill="#EF4444"
            stroke="#0F172A"
            strokeWidth="1.8"
            strokeLinejoin="round"
          />
          <circle cx="14.5" cy="9.5" r="2" fill="#FEF2F2" />
        </svg>
      );
    case 'frost':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M12 2.5V21.5M3.8 7.2L20.2 16.8M20.2 7.2L3.8 16.8"
            stroke="#38BDF8"
            strokeWidth="2.4"
            strokeLinecap="round"
          />
          <circle cx="12" cy="12" r="3.2" fill="#E0F2FE" stroke="#0F172A" strokeWidth="1.5" />
        </svg>
      );
    case 'magnet':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M6 5V12C6 15.3 8.7 18 12 18C15.3 18 18 15.3 18 12V5H14V12C14 13.1 13.1 14 12 14C10.9 14 10 13.1 10 12V5H6Z"
            fill="#A855F7"
            stroke="#0F172A"
            strokeWidth="1.8"
          />
          <rect x="6" y="4" width="4" height="3.5" fill="#E2E8F0" />
          <rect x="14" y="4" width="4" height="3.5" fill="#E2E8F0" />
        </svg>
      );
    case 'glitch':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <rect x="3.5" y="4.5" width="17" height="15" rx="4" fill="#EC4899" stroke="#0F172A" strokeWidth="1.8" />
          <path d="M8 10L11 13M11 10L8 13M13 10L16 13M16 10L13 13" stroke="#FDF2F8" strokeWidth="1.8" strokeLinecap="round" />
          <path d="M8.5 16H15.5" stroke="#FDF2F8" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      );
    case 'warp':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="12" cy="12" r="9" fill="#10B981" stroke="#0F172A" strokeWidth="1.8" />
          <path d="M12 6.5L16.5 12L12 17.5M7.5 12H15.5" stroke="#ECFDF5" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case 'barrier':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <rect x="4" y="4" width="4" height="16" rx="1.5" fill="#94A3B8" stroke="#0F172A" strokeWidth="1.5" />
          <rect x="16" y="4" width="4" height="16" rx="1.5" fill="#94A3B8" stroke="#0F172A" strokeWidth="1.5" />
          <path d="M8 8H16M8 12H16M8 16H16" stroke="#F97316" strokeWidth="2.5" strokeLinecap="round" />
        </svg>
      );
    case 'grease':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M12 3.5C12 3.5 7 9.2 7 13C7 15.8 9.2 18 12 18C14.8 18 17 15.8 17 13C17 9.2 12 3.5 12 3.5Z"
            fill="#84CC16"
            stroke="#0F172A"
            strokeWidth="1.8"
          />
          <ellipse cx="12" cy="19.5" rx="8" ry="2.2" fill="#4D7C0F" stroke="#0F172A" strokeWidth="1.4" />
        </svg>
      );
    case 'whirlwind':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M4 6H20M6 10.5H18.5M8 15H16M10 19.5H14.5"
            stroke="#22D3EE"
            strokeWidth="2.4"
            strokeLinecap="round"
          />
          <path d="M12 3L15 6.5H9L12 3Z" fill="#BAE6FD" />
        </svg>
      );
    case 'jetpack':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <rect x="5" y="4" width="5.5" height="11" rx="2.5" fill="#94A3B8" stroke="#0F172A" strokeWidth="1.6" />
          <rect x="13.5" y="4" width="5.5" height="11" rx="2.5" fill="#94A3B8" stroke="#0F172A" strokeWidth="1.6" />
          <rect x="9.5" y="7" width="5" height="5" rx="1" fill="#FB923C" stroke="#0F172A" strokeWidth="1.4" />
          <path d="M6 15L7.75 21.5L9.5 15H6Z" fill="#F97316" />
          <path d="M14.5 15L16.25 21.5L18 15H14.5Z" fill="#F97316" />
          <path d="M7 15L7.75 19L8.5 15H7ZM15.5 15L16.25 19L17 15H15.5Z" fill="#FEF08A" />
        </svg>
      );
  }
}

export function PauseIconSvg() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="6" y="5" width="4" height="14" rx="1.2" fill="currentColor" />
      <rect x="14" y="5" width="4" height="14" rx="1.2" fill="currentColor" />
    </svg>
  );
}

export function SoundIconSvg({ muted }: { muted: boolean }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M5 9.5H8.5L13.5 5V19L8.5 14.5H5V9.5Z"
        fill="currentColor"
      />
      {muted ? (
        <path d="M16.5 9L21 15M21 9L16.5 15" stroke="#F87171" strokeWidth="2.2" strokeLinecap="round" />
      ) : (
        <path
          d="M16.5 8.5C17.8 9.8 17.8 14.2 16.5 15.5M19 6C21.5 8.8 21.5 15.2 19 18"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
      )}
    </svg>
  );
}
