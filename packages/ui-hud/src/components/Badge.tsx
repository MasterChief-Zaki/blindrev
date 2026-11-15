import type { DataLabel } from "../coreTypes";
import { Icon, type IconName } from "./Icon";

export type BadgeKind = DataLabel | "INFO" | "OK" | "ALERT";

export interface BadgeProps {
  kind: BadgeKind;
  /** Extra mono detail after the word, e.g. "epoch 81 h old". */
  detail?: string;
  className?: string;
}

type Tone = "indigo" | "cyan" | "magenta" | "pearl" | "alert";

/** Icon + word for every kind — never colour alone. `code` is the visible telemetry word
 *  (exact honesty label), `spoken` is what screen readers hear. */
const META: Record<BadgeKind, { icon: IconName; code: string; spoken: string; tone: Tone }> = {
  SIMULATED: { icon: "waves", code: "SIMULATED", spoken: "Simulated data", tone: "indigo" },
  PLACEHOLDER: { icon: "hexagon", code: "PLACEHOLDER", spoken: "Placeholder data", tone: "pearl" },
  TEST_FIXTURE: { icon: "research", code: "TEST_FIXTURE", spoken: "Test fixture", tone: "pearl" },
  STALE_EPHEMERIS: { icon: "alert", code: "STALE_EPHEMERIS", spoken: "Alert: stale ephemeris", tone: "alert" },
  OFFLINE: { icon: "comms", code: "OFFLINE", spoken: "Offline", tone: "magenta" },
  INFO: { icon: "info", code: "INFO", spoken: "Info", tone: "cyan" },
  OK: { icon: "check", code: "OK", spoken: "OK", tone: "cyan" },
  ALERT: { icon: "alert", code: "ALERT", spoken: "Alert", tone: "alert" },
};

export function Badge({ kind, detail, className }: BadgeProps) {
  const m = META[kind];
  const cls = ["br-badge", `br-badge--${m.tone}`, className ?? ""].filter(Boolean).join(" ");
  return (
    <span className={cls} data-kind={kind} data-testid={`badge-${kind}`}>
      <Icon name={m.icon} size={16} />
      <span className="br-badge__word" aria-hidden="true">
        {m.code}
      </span>
      <span className="br-visually-hidden">{m.spoken}</span>
      {detail ? <span className="br-badge__detail">{detail}</span> : null}
    </span>
  );
}
