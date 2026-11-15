import type { ReactElement } from "react";

/** Brand icon set (guide p8) + the HUD controls from ARCHITECTURE §6.
 *  Extra names after `target` are a superset used inside ui-hud (info, plus, trash, undo, move, flag, sound, mute, chevron*). */
export type IconName =
  | "map"
  | "terrain"
  | "scanner"
  | "resources"
  | "team"
  | "journal"
  | "research"
  | "comms"
  | "timeLens"
  | "evidence"
  | "alert"
  | "locked"
  | "hexagon"
  | "circle"
  | "waves"
  | "infinity"
  | "play"
  | "pause"
  | "stepBack"
  | "stepForward"
  | "close"
  | "check"
  | "back"
  | "settings"
  | "layers"
  | "target"
  | "info"
  | "plus"
  | "trash"
  | "undo"
  | "move"
  | "flag"
  | "sound"
  | "mute"
  | "chevronLeft"
  | "chevronRight";

/** 24-unit grid, drawn with a 2 px stroke, rounded caps and joins. */
const PATHS: Record<IconName, ReactElement> = {
  map: (
    <>
      <path d="M3 6.5 9 4l6 2.5L21 4v13.5L15 20l-6-2.5L3 20Z" />
      <path d="M9 4v13.5M15 6.5V20" />
    </>
  ),
  terrain: (
    <>
      <path d="M2.5 19.5 9 9l3.6 5.6L15.5 11l6 8.5Z" />
      <circle cx="17.5" cy="5.5" r="1.8" />
    </>
  ),
  scanner: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="4.5" />
      <path d="M12 12 18.4 5.6" />
      <circle cx="15" cy="15.5" r="0.6" fill="currentColor" />
    </>
  ),
  resources: (
    <>
      <path d="M12 3 20 7.5v9L12 21l-8-4.5v-9Z" />
      <path d="M4 7.5 12 12l8-4.5M12 12v9" />
    </>
  ),
  team: (
    <>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3 19.5c.6-3.4 3-5.3 6-5.3s5.4 1.9 6 5.3" />
      <path d="M15.5 4.9a3.2 3.2 0 0 1 0 6.2M17.6 14.6c1.8.7 3 2.4 3.4 4.9" />
    </>
  ),
  journal: (
    <>
      <path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5Z" />
      <path d="M5 19.5A1.5 1.5 0 0 0 6.5 21H19v-3" />
      <path d="M9 7h6M9 10.5h4" />
    </>
  ),
  research: (
    <>
      <path d="M9.5 3h5M10.5 3v6L5 18.5A1.7 1.7 0 0 0 6.5 21h11a1.7 1.7 0 0 0 1.5-2.5L13.5 9V3" />
      <path d="M7.5 15h9" />
    </>
  ),
  comms: (
    <>
      <path d="M12 12v9M9 21h6" />
      <circle cx="12" cy="10" r="1.6" />
      <path d="M8.2 6.2a5.4 5.4 0 0 0 0 7.6M15.8 6.2a5.4 5.4 0 0 1 0 7.6" />
      <path d="M5.4 3.4a9.4 9.4 0 0 0 0 13.2M18.6 3.4a9.4 9.4 0 0 1 0 13.2" />
    </>
  ),
  timeLens: (
    <>
      <circle cx="10.5" cy="10.5" r="7" />
      <path d="M10.5 6.8v3.9l2.6 1.6" />
      <path d="m15.6 15.6 5.4 5.4" />
    </>
  ),
  evidence: (
    <>
      <path d="M3.5 12.4V4.5a1 1 0 0 1 1-1h7.9l8.6 8.6a1.4 1.4 0 0 1 0 2l-6.4 6.4a1.4 1.4 0 0 1-2 0Z" />
      <circle cx="8.2" cy="8.2" r="1.6" />
    </>
  ),
  alert: (
    <>
      <path d="M10.3 4.1 2.6 17.6A2 2 0 0 0 4.3 20.6h15.4a2 2 0 0 0 1.7-3L13.7 4.1a2 2 0 0 0-3.4 0Z" />
      <path d="M12 9.5v4.5" />
      <circle cx="12" cy="17" r="0.4" fill="currentColor" />
    </>
  ),
  locked: (
    <>
      <rect x="5" y="10.5" width="14" height="10" rx="2" />
      <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
      <path d="M12 14.5v2.5" />
    </>
  ),
  hexagon: (
    <path d="M10.6 2.8a2.8 2.8 0 0 1 2.8 0l6.1 3.5a2.8 2.8 0 0 1 1.4 2.4v6.6a2.8 2.8 0 0 1-1.4 2.4l-6.1 3.5a2.8 2.8 0 0 1-2.8 0l-6.1-3.5A2.8 2.8 0 0 1 3.1 15.3V8.7a2.8 2.8 0 0 1 1.4-2.4Z" />
  ),
  circle: <circle cx="12" cy="12" r="8.5" />,
  waves: (
    <>
      <path d="M2.5 8c2.4-2 4.6-2 7 0s4.6 2 7 0 4.6-2 5 0" />
      <path d="M2.5 13c2.4-2 4.6-2 7 0s4.6 2 7 0 4.6-2 5 0" />
      <path d="M2.5 18c2.4-2 4.6-2 7 0s4.6 2 7 0 4.6-2 5 0" />
    </>
  ),
  infinity: (
    <path d="M12 12c-2.2-3-3.8-4.3-6-4.3a4.3 4.3 0 0 0 0 8.6c2.2 0 3.8-1.3 6-4.3s3.8-4.3 6-4.3a4.3 4.3 0 0 1 0 8.6c-2.2 0-3.8-1.3-6-4.3Z" />
  ),
  play: <path d="M7.5 4.8v14.4a1 1 0 0 0 1.5.9l11.2-7.2a1 1 0 0 0 0-1.7L9 4a1 1 0 0 0-1.5.8Z" />,
  pause: (
    <>
      <rect x="6" y="4.5" width="4" height="15" rx="1" />
      <rect x="14" y="4.5" width="4" height="15" rx="1" />
    </>
  ),
  stepBack: (
    <>
      <path d="M6 5v14" />
      <path d="M18.5 5.8v12.4a.9.9 0 0 1-1.4.8L9 12.8a.9.9 0 0 1 0-1.6l8.1-6.2a.9.9 0 0 1 1.4.8Z" />
    </>
  ),
  stepForward: (
    <>
      <path d="M18 5v14" />
      <path d="M5.5 5.8v12.4a.9.9 0 0 0 1.4.8l8.1-6.2a.9.9 0 0 0 0-1.6L6.9 5a.9.9 0 0 0-1.4.8Z" />
    </>
  ),
  close: <path d="M6 6l12 12M18 6 6 18" />,
  check: <path d="m4.5 12.5 5 5 10-11" />,
  back: <path d="M19.5 12h-15M10.5 6l-6 6 6 6" />,
  settings: (
    <>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 2.8v2.7M12 18.5v2.7M2.8 12h2.7M18.5 12h2.7M5.5 5.5l1.9 1.9M16.6 16.6l1.9 1.9M5.5 18.5l1.9-1.9M16.6 7.4l1.9-1.9" />
      <circle cx="12" cy="12" r="6.6" />
    </>
  ),
  layers: (
    <>
      <path d="m12 3.5 9 4.8-9 4.8-9-4.8Z" />
      <path d="m3 12.5 9 4.8 9-4.8" />
      <path d="m3 16.5 9 4.8 9-4.8" />
    </>
  ),
  target: (
    <>
      <circle cx="12" cy="12" r="7.5" />
      <circle cx="12" cy="12" r="2.2" />
      <path d="M12 1.8v4M12 18.2v4M1.8 12h4M18.2 12h4" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5.5" />
      <circle cx="12" cy="7.6" r="0.4" fill="currentColor" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  trash: (
    <>
      <path d="M4 6.5h16M9.5 6.5V4.2a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v2.3" />
      <path d="M6.2 6.5 7.1 19.6a1.6 1.6 0 0 0 1.6 1.4h6.6a1.6 1.6 0 0 0 1.6-1.4l.9-13.1" />
      <path d="M10 10.5v6M14 10.5v6" />
    </>
  ),
  undo: (
    <>
      <path d="M8.5 5 4 9.5 8.5 14" />
      <path d="M4 9.5h10a6 6 0 0 1 0 12h-3" />
    </>
  ),
  move: (
    <>
      <path d="M12 3v18M3 12h18" />
      <path d="m9 5.5 3-2.5 3 2.5M9 18.5l3 2.5 3-2.5M5.5 9 3 12l2.5 3M18.5 9l2.5 3-2.5 3" />
    </>
  ),
  flag: (
    <>
      <path d="M5.5 21V3.5" />
      <path d="M5.5 4h11.8a.8.8 0 0 1 .6 1.3L15.5 8.5l2.4 3.2a.8.8 0 0 1-.6 1.3H5.5" />
    </>
  ),
  sound: (
    <>
      <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4Z" />
      <path d="M15.5 9a4.2 4.2 0 0 1 0 6M18.2 6.3a8 8 0 0 1 0 11.4" />
    </>
  ),
  mute: (
    <>
      <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4Z" />
      <path d="m16 9.5 5 5M21 9.5l-5 5" />
    </>
  ),
  chevronLeft: <path d="m14.5 5.5-6.5 6.5 6.5 6.5" />,
  chevronRight: <path d="m9.5 5.5 6.5 6.5-6.5 6.5" />,
};

export const ICON_NAMES = Object.keys(PATHS) as IconName[];

export interface IconProps {
  name: IconName;
  size?: 16 | 24 | 32 | 48;
  /** Accessible name. Omit for decorative icons (always paired with a visible word). */
  title?: string;
  className?: string;
}

export function Icon({ name, size = 24, title, className }: IconProps) {
  const labelled = title !== undefined && title !== "";
  return (
    <svg
      className={className ? `br-icon ${className}` : "br-icon"}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={labelled ? "img" : undefined}
      aria-label={labelled ? title : undefined}
      aria-hidden={labelled ? undefined : true}
      focusable="false"
      data-icon={name}
    >
      {labelled ? <title>{title}</title> : null}
      {PATHS[name]}
    </svg>
  );
}
