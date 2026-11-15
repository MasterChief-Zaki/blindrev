import { type ReactNode, useId } from "react";

export interface PanelProps {
  title?: string;
  /** Mono telemetry line above the title, e.g. "CASE_001 / READY". */
  kicker?: string;
  /** 24 px chamfered corners — mission, scanner and research panels only. */
  chamfer?: boolean;
  tone?: "graphite" | "ink" | "scrim";
  actions?: ReactNode;
  as?: "section" | "aside" | "div";
  className?: string;
  id?: string;
  "data-testid"?: string;
  children?: ReactNode;
}

export function Panel({
  title,
  kicker,
  chamfer = false,
  tone = "graphite",
  actions,
  as: Tag = "section",
  className,
  id,
  children,
  ...rest
}: PanelProps) {
  const headingId = useId();
  const hasHeader = Boolean(title || kicker || actions);
  const cls = ["br-panel", `br-panel--${tone}`, chamfer ? "br-panel--chamfer" : "", className ?? ""]
    .filter(Boolean)
    .join(" ");
  return (
    <Tag className={cls} id={id} aria-labelledby={title ? headingId : undefined} data-testid={rest["data-testid"]}>
      <div className="br-panel__inner">
        {chamfer ? <span className="br-panel__notch" aria-hidden="true" /> : null}
        {hasHeader ? (
          <header className="br-panel__header">
            <div className="br-panel__titles">
              {kicker ? <p className="br-kicker br-panel__kicker">{kicker}</p> : null}
              {title ? (
                <h2 id={headingId} className="br-h4 br-panel__title">
                  {title}
                </h2>
              ) : null}
            </div>
            {actions ? <div className="br-panel__actions">{actions}</div> : null}
          </header>
        ) : null}
        <div className="br-panel__body">{children}</div>
      </div>
    </Tag>
  );
}
