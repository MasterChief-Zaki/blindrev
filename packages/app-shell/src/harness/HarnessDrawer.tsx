import { useEffect, useState } from "react";
import { routeTimings, p95 } from "../scene/navigation";
import { lifecycle } from "../scene/sceneManager";
import { useApp } from "../store";

type Api = {
  perf: {
    frames: { start(): void; stop(): unknown; stats(): { p50Ms: number | null; p95Ms: number | null; count: number } };
    heapMb(): number | null;
    contextLossCycles(n?: number): Promise<unknown>;
    soak: { start(min?: number): unknown; status(): unknown };
  };
  exportTelemetry(download?: boolean): unknown;
};

/** `?harness=1` — small diagnostics drawer. */
export function HarnessDrawer() {
  const [open, setOpen] = useState(true);
  const [tick, setTick] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const route = useApp((s) => s.route);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);
  const api = (window as unknown as { __BLINDREV__?: Api }).__BLINDREV__;
  if (!api) return null;
  const f = api.perf.frames.stats();
  const heap = api.perf.heapMb();
  const bp = p95(routeTimings.map((t) => t.blankMs));
  return (
    <div className={`harness${open ? "" : " is-closed"}`} data-tick={tick} data-testid="harness">
      <button type="button" className="harness__toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
        Harness
      </button>
      {open && (
        <div className="harness__body br-mono">
          <div>
            route {route} · live renderers {lifecycle.created - lifecycle.destroyed} (max {lifecycle.maxLive})
          </div>
          <div>
            frames n={f.count} p50={f.p50Ms?.toFixed(1) ?? "—"} p95={f.p95Ms?.toFixed(1) ?? "—"} ms
          </div>
          <div>heap {heap === null ? "NOT MEASURED (no performance.memory)" : `${heap.toFixed(1)} MB`}</div>
          <div>
            route blank p95 {bp === null ? "—" : `${bp.toFixed(0)} ms`} ({routeTimings.length} switches)
          </div>
          <div className="harness__row">
            <button type="button" onClick={() => api.perf.frames.start()}>
              frames ▶
            </button>
            <button type="button" onClick={() => api.perf.frames.stop()}>
              frames ■
            </button>
            <button
              type="button"
              disabled={!!busy}
              onClick={() => {
                setBusy("ctx");
                void api.perf.contextLossCycles(10).then((r) => {
                  console.info("[harness] context loss", r);
                  setBusy(null);
                });
              }}
            >
              {busy === "ctx" ? "ctx…" : "ctx-loss ×10"}
            </button>
            <button type="button" onClick={() => api.perf.soak.start(1)}>
              soak 1 min
            </button>
            <button type="button" onClick={() => api.exportTelemetry(true)}>
              export
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
