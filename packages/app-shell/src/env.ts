/** URL / environment flags, read once at startup. */
const params = new URLSearchParams(typeof location !== "undefined" ? location.search : "");

function num(name: string): number | null {
  const v = params.get(name);
  if (v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export type RouteId = "menu" | "hub" | "mission";

function routeParam(): RouteId | null {
  const r = params.get("route");
  return r === "menu" || r === "hub" || r === "mission" ? r : null;
}

export const env = {
  /** `?stub=1` — deterministic Canvas2D renderers (offline visual-CI fixture). */
  stub: params.get("stub") === "1",
  /** `?hub=2d` — static 2D command board instead of the 3D hub (A1 kill fallback). */
  hub2d: params.get("hub") === "2d",
  /** `?harness=1` — diagnostics drawer. */
  harness: params.get("harness") === "1",
  /** `?soak=<minutes>` — start the heap soak automatically. */
  soakMinutes: num("soak"),
  /** `?route=hub|mission` — jump straight to a route (E2E / screenshots). */
  initialRoute: routeParam(),
  /** `?offline=1` — never touch the network (tests). */
  offline: params.get("offline") === "1",
  /** `?motion=reduced|full` — override reduced motion for this session. */
  motion: params.get("motion"),
  /** `?now=<iso>` — fixed clock for deterministic screenshots. */
  fixedNow: params.get("now"),
  ionToken: ((import.meta.env.VITE_CESIUM_ION_TOKEN as string | undefined) ?? "").trim() || null,
  isTauri: typeof window !== "undefined" && ("__TAURI_INTERNALS__" in window || "__TAURI__" in window),
} as const;

/** Clock used for ephemeris + journal. Fixed when `?now=` is given. */
export function nowDate(): Date {
  if (env.fixedNow) {
    const d = new Date(env.fixedNow);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return new Date();
}

/** Resolve a runtime asset path (relative, no leading slash) against the app base URL. */
export function assetUrl(rel: string): string {
  return new URL(rel, document.baseURI).href;
}
