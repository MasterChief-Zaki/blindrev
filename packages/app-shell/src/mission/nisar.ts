/* NISAR ephemeris: bundled TLE snapshot synchronously, optional async CelesTrak refresh (≤ every 2 h,
 * localStorage cache; any failure = snapshot-only). Propagated state, not live telemetry. */
import { ephemerisStatus, nadirGroundTrack, propagateTle, tleEpoch, tleLineChecksumOk } from "@blindrev/core-sim";
import type { OrbitState } from "@blindrev/core-sim";
import { loadPrefabs, loadTleSnapshot } from "../data/loaders";
import { env, nowDate } from "../env";
import { useApp } from "../store";

interface Tle {
  name: string;
  line1: string;
  line2: string;
}

const CACHE_KEY = "blindrev.tle.v1";
const ATTEMPT_KEY = "blindrev.tle.lastAttempt.v1";
const REFRESH_MIN_INTERVAL_MS = 2 * 3600 * 1000;
export const CELESTRAK_URL = "https://celestrak.org/NORAD/elements/gp.php?CATNR=65053&FORMAT=TLE";

export interface TleRefreshRecord {
  at: string;
  outcome:
    | "skipped-offline"
    | "skipped-automation"
    | "skipped-cache-fresh"
    | "ok"
    | "cors-or-network-error"
    | "http-error"
    | "parse-error"
    | "older-than-current";
  detail: string;
}
export const tleRefreshLog: TleRefreshRecord[] = [];

let tle: Tle | null = null;

export function currentTle(): Tle {
  if (!tle) {
    const snap = loadTleSnapshot();
    tle = { name: snap.name, line1: snap.line1, line2: snap.line2 };
    useApp.setState({ tleSource: "snapshot", tleEpochIso: tleEpoch(tle).toISOString() });
    const cached = readCache();
    if (cached && tleEpoch(cached.tle).getTime() > tleEpoch(tle).getTime()) {
      tle = cached.tle;
      useApp.setState({ tleSource: "cache", tleEpochIso: tleEpoch(tle).toISOString() });
    }
  }
  return tle;
}

function readCache(): { tle: Tle; fetchedAt: number } | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as { name: string; line1: string; line2: string; fetchedAt: number };
    if (!tleLineChecksumOk(v.line1) || !tleLineChecksumOk(v.line2)) return null;
    return { tle: { name: v.name, line1: v.line1, line2: v.line2 }, fetchedAt: v.fetchedAt };
  } catch {
    return null;
  }
}

function log(outcome: TleRefreshRecord["outcome"], detail: string): void {
  tleRefreshLog.push({ at: new Date().toISOString(), outcome, detail });
  if (outcome !== "ok" && outcome !== "skipped-cache-fresh") console.info(`[tle] refresh ${outcome}: ${detail}`);
}

/** Async CelesTrak refresh. Never throws. */
export async function refreshTle(): Promise<void> {
  currentTle();
  if (env.offline || env.stub || env.fixedNow) {
    log("skipped-offline", "offline/stub/fixed-clock session — snapshot only");
    return;
  }
  if (typeof navigator !== "undefined" && navigator.webdriver) {
    // Automated runs (Playwright / CI) use fresh profiles, so the 2 h cache never applies and CelesTrak answers
    // 403 (rate limit) after a few runs. Gating tests must not touch the network anyway.
    log("skipped-automation", "navigator.webdriver — snapshot only");
    return;
  }
  // CelesTrak throttles repeated downloads (HTTP 403): the 2 h minimum applies to every ATTEMPT, failed or not.
  let lastAttempt = 0;
  try {
    lastAttempt = Number(localStorage.getItem(ATTEMPT_KEY) ?? 0) || 0;
  } catch {
    /* ignore */
  }
  if (Date.now() - lastAttempt < REFRESH_MIN_INTERVAL_MS) {
    log("skipped-cache-fresh", `last attempt ${Math.round((Date.now() - lastAttempt) / 60000)} min ago (2 h minimum)`);
    return;
  }
  try {
    localStorage.setItem(ATTEMPT_KEY, String(Date.now()));
  } catch {
    /* ignore */
  }
  const cached = readCache();
  if (cached && Date.now() - cached.fetchedAt < REFRESH_MIN_INTERVAL_MS) {
    log("skipped-cache-fresh", `cached ${Math.round((Date.now() - cached.fetchedAt) / 60000)} min ago`);
    return;
  }
  let text: string;
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 8000);
    const r = await fetch(CELESTRAK_URL, { signal: ctl.signal, cache: "no-store" });
    clearTimeout(t);
    if (!r.ok) {
      log("http-error", `HTTP ${r.status}`);
      return;
    }
    text = await r.text();
  } catch (e) {
    log("cors-or-network-error", e instanceof Error ? e.message : String(e));
    return;
  }
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter(Boolean);
  const i1 = lines.findIndex((l) => l.startsWith("1 65053"));
  const l1 = lines[i1];
  const l2 = lines[i1 + 1];
  if (i1 < 0 || !l1 || !l2 || !l2.startsWith("2 65053") || !tleLineChecksumOk(l1) || !tleLineChecksumOk(l2)) {
    log("parse-error", text.slice(0, 80));
    return;
  }
  const fresh: Tle = { name: (lines[i1 - 1] ?? "NISAR").trim(), line1: l1, line2: l2 };
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ ...fresh, fetchedAt: Date.now() }));
  } catch {
    /* ignore */
  }
  const cur = currentTle();
  if (tleEpoch(fresh).getTime() < tleEpoch(cur).getTime()) {
    log("older-than-current", fresh.line1.slice(18, 32));
    return;
  }
  tle = fresh;
  groundTrackCache = null;
  useApp.setState({ tleSource: "celestrak", tleEpochIso: tleEpoch(fresh).toISOString() });
  log("ok", `epoch ${tleEpoch(fresh).toISOString()}`);
}

export function propagateNow(): OrbitState | null {
  return propagateTle(currentTle(), nowDate());
}

function updateNisar(): void {
  const t = currentTle();
  const now = nowDate();
  const state = propagateTle(t, now);
  const maxAge = loadPrefabs().constants.tle.maxAgeHours;
  const eph = ephemerisStatus(t, now, maxAge);
  useApp.setState({ nisar: state, tleAgeHours: eph.ageHours, tleStale: eph.stale });
}

let timer: ReturnType<typeof setInterval> | null = null;
export function startNisarTicker(): void {
  if (timer) return;
  updateNisar();
  timer = setInterval(updateNisar, 1000);
}

/** Orbital period from mean motion (rev/day) in TLE line 2, cols 53–63. */
export function orbitalPeriodS(t: Tle = currentTle()): number {
  const n = Number.parseFloat(t.line2.slice(52, 63));
  return Number.isFinite(n) && n > 0 ? 86400 / n : 5990;
}

let groundTrackCache: { centreMs: number; track: OrbitState[] } | null = null;
/** Nadir ground track ± one orbit around now (recomputed every 10 min). */
export function groundTrack(): OrbitState[] {
  const now = nowDate().getTime();
  if (groundTrackCache && Math.abs(now - groundTrackCache.centreMs) < 600_000) return groundTrackCache.track;
  const period = orbitalPeriodS();
  const start = new Date(now - period * 1000);
  const track = nadirGroundTrack(currentTle(), start, period * 2, 20);
  groundTrackCache = { centreMs: now, track };
  return track;
}
