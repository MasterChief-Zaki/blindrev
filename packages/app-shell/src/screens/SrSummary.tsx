import { useState } from "react";
import { fmtDate, getMission, pairStatus, stepById } from "../mission/controller";
import { useApp } from "../store";
import { outcomeHeadline } from "./Overlays";

/** Always-present DOM transcript of the mission for screen readers (§15). Visually hidden unless expanded. */
export function SrSummary() {
  const [open, setOpen] = useState(false);
  const route = useApp((s) => s.route);
  const m = useApp((s) => s.mission);
  const status = useApp((s) => s.globeStatus);
  if (route !== "mission") return null;
  const mission = getMission();
  const b = mission.briefing;
  const p = pairStatus();
  const o = m.outcome;
  return (
    <section
      className={open ? "sr-summary is-open" : "sr-summary"}
      aria-labelledby="sr-summary-h"
      data-testid="sr-summary"
    >
      <button type="button" className="sr-summary__toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? "Hide mission transcript" : "Show mission transcript"}
      </button>
      <div className={open ? "sr-summary__body" : "br-visually-hidden"}>
        <h2 id="sr-summary-h">Mission transcript: {mission.title}</h2>
        <h3>Briefing</h3>
        <p>{b.question}</p>
        <p>
          {b.location}. {b.dates}. Source: {b.source}.
        </p>
        <p>{b.summary}</p>
        {b.body.map((t) => (
          <p key={t.slice(0, 32)}>{t}</p>
        ))}
        <p>Data labels: {mission.labels.join(", ")}.</p>
        <h3>Temporal steps ({mission.steps.length})</h3>
        <ol>
          {mission.steps.map((s, i) => (
            <li key={s.stepId} aria-current={i === m.index ? "step" : undefined}>
              {fmtDate(s.date)} — {s.isAvailable ? `acquired by ${s.platform} ${s.instrument}` : "no acquisition"}
              {i === m.index ? " (current)" : ""}
              {s.stepId === m.pair.a ? " (date A)" : ""}
              {s.stepId === m.pair.b ? " (date B)" : ""}
            </li>
          ))}
        </ol>
        <p>Watch state: {m.watchState.toLowerCase().replace("_", " ")}.</p>
        <h3>Date pair</h3>
        <p>
          {m.pair.a ? fmtDate(stepById(m.pair.a)?.date ?? "") : "A not set"} and{" "}
          {m.pair.b ? fmtDate(stepById(m.pair.b)?.date ?? "") : "B not set"}.{" "}
          {p.ok ? `${Math.round(p.dtDays ?? 0)} days apart.` : p.reason}
        </p>
        <h3>Region of interest</h3>
        {m.vertices.length ? (
          <>
            <p>
              {m.vertices.length} corners, {m.closed ? "closed" : "open"}
              {m.validation ? `, ${m.validation.areaKm2.toFixed(1)} square kilometres` : ""}.
              {m.validation && !m.validation.ok
                ? ` Problems: ${m.validation.errors.map((e) => e.message).join(" ")}`
                : ""}
            </p>
            <ol>
              {m.vertices.map((v, i) => (
                <li key={`${i}-${v.lon}-${v.lat}`}>
                  Latitude {v.lat.toFixed(4)}, longitude {v.lon.toFixed(4)}
                  {m.selectedIndex === i ? " (selected)" : ""}
                </li>
              ))}
            </ol>
          </>
        ) : (
          <p>No region marked yet.</p>
        )}
        <h3>Diagnostics</h3>
        <p>
          Globe:{" "}
          {status
            ? `${status.terrain === "ELLIPSOID" ? "ellipsoid terrain" : "world terrain"}, ${status.offline ? "offline bundled imagery" : "online imagery"}`
            : "loading"}
          .{m.noAcquisition ? ` No acquisition on ${fmtDate(m.noAcquisition.date)}.` : ""}
        </p>
        <h3>Verdict</h3>
        {o ? (
          <p>
            {outcomeHeadline(o).tier}: {outcomeHeadline(o).word}.{" "}
            {o.kind === "SCORE"
              ? `Overlap ${o.iou.toFixed(3)}, precision ${o.precision.toFixed(3)}, recall ${o.recall.toFixed(3)}.`
              : o.message}{" "}
            Mission scoring against an authored reference mask — not a scientific measurement.
          </p>
        ) : (
          <p>Not validated yet.</p>
        )}
      </div>
    </section>
  );
}
