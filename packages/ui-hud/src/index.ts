// @blindrev/ui-hud — Outpost Signal design system (ARCHITECTURE §6).
// Styles: `import "@blindrev/ui-hud/styles.css"` (tokens + fonts + base + components).

export { Badge, type BadgeKind, type BadgeProps } from "./components/Badge";
export { Button, type ButtonProps } from "./components/Button";
export { Slider, type SliderProps, Tabs, type TabsProps, Toggle, type ToggleProps } from "./components/Controls";
export { ICON_NAMES, Icon, type IconName, type IconProps } from "./components/Icon";
export { ANNOUNCE_DEDUPE_MS, announce, getAnnouncements, LiveRegion, type Politeness } from "./components/LiveRegion";
export { Logo, type LogoProps, type LogoVariant } from "./components/Logo";
export { HexSpinner, type HexSpinnerProps } from "./components/HexSpinner";
export { KeyHint, type KeyHintProps, MenuList, type MenuListItem, type MenuListProps } from "./components/MenuList";
export {
  ToolButton,
  type ToolButtonProps,
  type ToolDef,
  ToolRail,
  type ToolRailProps,
  type ToolStatus,
} from "./components/ToolRail";
export { Modal, type ModalProps } from "./components/Modal";
export { toast, type ToastOptions } from "./components/Toast";
export { Panel, type PanelProps } from "./components/Panel";
export {
  Legend,
  type LegendProps,
  ProgressBar,
  type ProgressBarProps,
  Stat,
  type StatProps,
} from "./components/Readouts";
export { ReturnButton, type ReturnButtonProps } from "./components/ReturnButton";
export { WipeOverlay, type WipeOverlayProps, type WipePhase } from "./components/WipeOverlay";

export {
  daysApart,
  TemporalTimeline,
  type TemporalTimelineProps,
  type TimelinePair,
  timelineValueText,
} from "./timeline/TemporalTimeline";

export { RoiEditor2D, type RoiEditor2DProps } from "./roi/RoiEditor2D";
export {
  clampToBounds,
  type EditorPoint,
  type EditorSize,
  editorSizeForBounds,
  editorToLonLat,
  formatLat,
  formatLon,
  graticuleLines,
  lonLatToEditor,
  niceStep,
  roundDeg,
} from "./roi/mapping";

export {
  AMBIENT_LOOP_FILE,
  getSoundStatus,
  initSound,
  playSound,
  SOUND_FILES,
  type SoundName,
  type SoundOptions,
  setAmbient,
  setSoundEnabled,
  setVolume,
} from "./sound/sound";
