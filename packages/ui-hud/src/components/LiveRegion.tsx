import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

export type Politeness = "polite" | "assertive";

type Listener = (politeness: Politeness, message: string) => void;
const listeners = new Set<Listener>();
const lastSent: Record<Politeness, { message: string; at: number }> = {
  polite: { message: "", at: -Infinity },
  assertive: { message: "", at: -Infinity },
};
/** Identical messages within this window are dropped (rapid repeats, e.g. holding an arrow key). */
export const ANNOUNCE_DEDUPE_MS = 1200;
const history: { message: string; politeness: Politeness; at: number }[] = [];

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

/** Speak a message through the single app-wide live region (mount `<LiveRegion />` once). */
export function announce(message: string, politeness: Politeness = "polite"): void {
  const msg = message.trim();
  if (!msg) return;
  const t = now();
  const last = lastSent[politeness];
  if (last.message === msg && t - last.at < ANNOUNCE_DEDUPE_MS) return;
  lastSent[politeness] = { message: msg, at: t };
  history.push({ message: msg, politeness, at: t });
  if (history.length > 50) history.shift();
  for (const fn of listeners) fn(politeness, msg);
}

/** Recent announcements (newest last) — for tests and the debug handle. */
export function getAnnouncements(): ReadonlyArray<{ message: string; politeness: Politeness; at: number }> {
  return history.slice();
}

/** One polite + one assertive host, portalled to <body> so modals never make them inert. */
export function LiveRegion() {
  const [polite, setPolite] = useState("");
  const [assertive, setAssertive] = useState("");
  const [host, setHost] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const el = document.createElement("div");
    el.dataset.brLive = "true";
    el.className = "br-live";
    document.body.appendChild(el);
    setHost(el);
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const fn: Listener = (p, m) => {
      const set = p === "assertive" ? setAssertive : setPolite;
      // Clear, then set on the next tick so screen readers re-announce identical text later on.
      set("");
      const t = setTimeout(() => {
        timers.delete(t);
        set(m);
      }, 60);
      timers.add(t);
    };
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
      for (const t of timers) clearTimeout(t);
      el.remove();
    };
  }, []);

  if (!host) return null;
  return createPortal(
    <>
      <div className="br-visually-hidden" aria-live="polite" aria-atomic="true" role="status" data-testid="live-polite">
        {polite}
      </div>
      <div
        className="br-visually-hidden"
        aria-live="assertive"
        aria-atomic="true"
        role="alert"
        data-testid="live-assertive"
      >
        {assertive}
      </div>
    </>,
    host,
  );
}
