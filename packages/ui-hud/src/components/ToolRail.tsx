import { playSound } from "../sound/sound";
import { Icon, type IconName } from "./Icon";

export type ToolStatus = "available" | "active" | "locked";

export interface ToolDef {
  id: string;
  label: string;
  icon: IconName;
  status: ToolStatus;
  /** Shown under the label when locked (e.g. "Unlocks in a later case") or as a hint otherwise. */
  reason?: string;
  /** Optional key shown as a hint, e.g. "T". (The caller binds the key.) */
  shortcut?: string;
}

export interface ToolButtonProps {
  tool: ToolDef;
  onSelect(id: string): void;
  /** Hide the label text visually (icon-only rail); the label stays as the accessible name + tooltip. */
  compact?: boolean;
}

/** Investigator tool (§10): icon + label; available / active (cyan, pressed) / locked (lock + reason, focusable). */
export function ToolButton({ tool, onSelect, compact = false }: ToolButtonProps) {
  const locked = tool.status === "locked";
  const active = tool.status === "active";
  const reasonId = `br-tool-reason-${tool.id}`;
  return (
    <button
      type="button"
      className={`br-tool br-tool--${tool.status}${compact ? " br-tool--compact" : ""}`}
      aria-pressed={locked ? undefined : active}
      aria-disabled={locked ? true : undefined}
      aria-describedby={tool.reason ? reasonId : undefined}
      title={compact ? `${tool.label}${tool.reason ? ` — ${tool.reason}` : ""}` : tool.reason}
      onClick={(e) => {
        if (locked) {
          e.preventDefault();
          return;
        }
        playSound("press");
        onSelect(tool.id);
      }}
      data-testid={`tool-${tool.id}`}
      data-status={tool.status}
    >
      <span className="br-tool__icon">
        <Icon name={tool.icon} size={24} />
        {locked ? (
          <span className="br-tool__lock">
            <Icon name="locked" size={16} />
          </span>
        ) : null}
      </span>
      <span className={compact ? "br-visually-hidden" : "br-tool__text"}>
        <span className="br-tool__label">{tool.label}</span>
        {tool.reason ? (
          <span id={reasonId} className="br-tool__reason">
            {locked ? "Locked — " : ""}
            {tool.reason}
          </span>
        ) : locked ? (
          <span className="br-tool__reason">Locked</span>
        ) : null}
      </span>
      {active ? (
        <span className="br-tool__state br-mono" aria-hidden="true">
          ON
        </span>
      ) : null}
      {tool.shortcut && !compact ? (
        <span className="br-tool__key" aria-hidden="true">
          {tool.shortcut}
        </span>
      ) : null}
    </button>
  );
}

export interface ToolRailProps {
  tools: ToolDef[];
  onSelect(id: string): void;
  /** Accessible name. Default "Investigator tools". */
  label?: string;
  orientation?: "vertical" | "horizontal";
  compact?: boolean;
}

export function ToolRail({
  tools,
  onSelect,
  label = "Investigator tools",
  orientation = "vertical",
  compact = false,
}: ToolRailProps) {
  return (
    <div
      className={`br-toolrail br-toolrail--${orientation}`}
      role="toolbar"
      aria-label={label}
      aria-orientation={orientation}
      data-testid="tool-rail"
    >
      {tools.map((t) => (
        <ToolButton key={t.id} tool={t} onSelect={onSelect} compact={compact} />
      ))}
    </div>
  );
}
