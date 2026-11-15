import { Badge, Panel, Stat } from "@blindrev/ui-hud";
import { useApp } from "../store";

function fmtAge(h: number): string {
  if (!Number.isFinite(h)) return "unknown";
  const abs = Math.abs(h);
  if (abs < 48) return `${abs.toFixed(1)} h`;
  return `${(abs / 24).toFixed(1)} d`;
}

export function NisarPanel({ compact = false }: { compact?: boolean }) {
  const nisar = useApp((s) => s.nisar);
  const stale = useApp((s) => s.tleStale);
  const age = useApp((s) => s.tleAgeHours);
  const epoch = useApp((s) => s.tleEpochIso);
  const source = useApp((s) => s.tleSource);
  const lat = nisar ? `${Math.abs(nisar.latDeg).toFixed(3)}° ${nisar.latDeg >= 0 ? "N" : "S"}` : "—";
  const lon = nisar ? `${Math.abs(nisar.lonDeg).toFixed(3)}° ${nisar.lonDeg >= 0 ? "E" : "W"}` : "—";
  const h = nisar ? (nisar.heightM / 1000).toFixed(1) : "—";
  return (
    <Panel tone="scrim" kicker="NISAR · NORAD 65053" title={compact ? undefined : "NISAR position"} as="section">
      <div className={`nisar${compact ? " nisar--compact" : ""}`} data-testid="nisar-panel">
        <div className="nisar__stats">
          <Stat label="Latitude" value={lat} mono />
          <Stat label="Longitude" value={lon} mono />
          <Stat label="Height" value={h} unit="km" mono />
        </div>
        {!compact && (
          <p className="br-mono nisar__epoch">
            TLE epoch {epoch ? `${epoch.slice(0, 16).replace("T", " ")} UTC` : "—"} · age {fmtAge(age)} ·{" "}
            {source === "snapshot" ? "bundled snapshot" : source === "cache" ? "cached CelesTrak" : "CelesTrak"}
          </p>
        )}
        <div className="badge-row">
          {stale ? (
            <Badge kind="STALE_EPHEMERIS" detail={`TLE is ${fmtAge(age)} old`} />
          ) : (
            <Badge kind="OK" detail={`Fresh TLE · ${fmtAge(age)}`} />
          )}
        </div>
        <p className="br-caption nisar__note">Propagated from TLE — not live telemetry.</p>
      </div>
    </Panel>
  );
}
