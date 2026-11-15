import { test as base, expect, type Locator, type Page } from "@playwright/test";

/** Fixed clock: 5.6 h after the bundled TLE epoch (2026-11-15T12:25:21Z) — fresh ephemeris. */
export const NOW = "2026-11-15T18:00:00.000Z";
/** > 72 h after the TLE epoch — must raise STALE_EPHEMERIS. */
export const NOW_STALE = "2026-11-19T18:00:00.000Z";

export const CYAN = "rgb(61, 224, 208)";

/** Offline deterministic fixture URL: stub renderers, no network, fixed clock. */
export function appUrl(params: Record<string, string> = {}): string {
  const p = new URLSearchParams({ stub: "1", offline: "1", now: NOW, ...params });
  return `/?${p.toString()}`;
}

/** Console errors that are not app defects (none known yet — every entry must be justified). */
const ALLOWED_CONSOLE: RegExp[] = [];

type Guard = { errors: string[]; blocked: string[] };
type Opts = { allowNetwork: boolean };

export const test = base.extend<Opts & { guard: Guard }>({
  allowNetwork: [false, { option: true }],
  guard: [
    async ({ page, context, allowNetwork, baseURL }, use) => {
      const errors: string[] = [];
      const blocked: string[] = [];
      const origin = new URL(baseURL ?? "http://localhost:4174").origin;
      if (!allowNetwork) {
        await context.route("**/*", (route) => {
          const url = route.request().url();
          if (url.startsWith(origin) || url.startsWith("data:") || url.startsWith("blob:")) return route.continue();
          blocked.push(url);
          return route.abort("blockedbyclient");
        });
      }
      // Record every text that lands in an aria-live host (announcements may be cleared quickly).
      await context.addInitScript(() => {
        const w = window as unknown as { __liveLog: { t: number; politeness: string; text: string }[] };
        w.__liveLog = [];
        const seen = new WeakSet<Node>();
        const record = (el: Element) => {
          const text = (el.textContent ?? "").trim();
          if (text) w.__liveLog.push({ t: performance.now(), politeness: el.getAttribute("aria-live") ?? "", text });
        };
        const mo = new MutationObserver((muts) => {
          for (const m of muts) {
            let n: Node | null = m.target;
            while (n && n.nodeType !== 1) n = n.parentNode;
            const host = (n as Element | null)?.closest?.("[aria-live]");
            if (host && host.getAttribute("aria-live") !== "off") record(host);
            for (const a of Array.from(m.addedNodes)) {
              if (a.nodeType === 1 && !seen.has(a)) {
                seen.add(a);
                const el = a as Element;
                if (el.matches("[aria-live]:not([aria-live=off])")) record(el);
              }
            }
          }
        });
        const start = () =>
          mo.observe(document.documentElement, { subtree: true, childList: true, characterData: true });
        if (document.documentElement) start();
        else document.addEventListener("DOMContentLoaded", start);
      });
      page.on("console", (m) => {
        if (m.type() === "error") errors.push(m.text());
      });
      page.on("pageerror", (e) => errors.push(`pageerror: ${String(e)}`));
      await use({ errors, blocked });
      const unexpected = errors.filter((e) => !ALLOWED_CONSOLE.some((r) => r.test(e)));
      expect(unexpected, "unexpected console errors").toEqual([]);
      if (!allowNetwork) expect(blocked, "requests outside the local origin (no network in gating tests)").toEqual([]);
    },
    { auto: true },
  ],
});
export { expect };

/* ------------------------------------------------------------------ harness helpers */

export async function waitHarness(page: Page): Promise<void> {
  await page.waitForFunction(() => !!(window as any).__BLINDREV__, null, { timeout: 30_000 });
}
export async function waitIdle(page: Page): Promise<void> {
  await page.waitForFunction(() => (window as any).__BLINDREV__?.state().wipe.phase === "idle", null, {
    timeout: 60_000,
  });
}
export async function state(page: Page): Promise<any> {
  return page.evaluate(() => (window as any).__BLINDREV__.state());
}
export async function waitScene(page: Page, kind: "globe" | "hub"): Promise<void> {
  await page.waitForFunction((k) => (window as any).__BLINDREV__?.state().scene?.kind === k, kind, { timeout: 60_000 });
}

/** Open the app on the menu with a clean journal. */
export async function openMenu(page: Page, params: Record<string, string> = {}): Promise<void> {
  await page.goto(appUrl(params));
  await waitHarness(page);
  await page.evaluate(() => localStorage.removeItem("blindrev.journal.v1"));
  await page.reload();
  await waitHarness(page);
  await expect(page.getByTestId("menu")).toBeVisible();
  await waitIdle(page);
  await page.evaluate(() => document.fonts.ready);
}

/** Jump straight to the mission route (harness-driven, for specs that do not test navigation). */
export async function openMission(page: Page, params: Record<string, string> = {}): Promise<void> {
  await page.goto(appUrl({ route: "mission", ...params }));
  await waitHarness(page);
  await page.evaluate(() => localStorage.removeItem("blindrev.journal.v1"));
  await expect(page.getByTestId("mission")).toBeVisible({ timeout: 60_000 });
  await waitIdle(page);
  await page.evaluate(() => document.fonts.ready);
}

export async function closeOverlays(page: Page): Promise<void> {
  await page.evaluate(() => (window as any).__BLINDREV__.actions.closeOverlay());
}

/** The authored reference polygon as an open ring (closing vertex dropped). */
export async function referenceRing(page: Page): Promise<{ lon: number; lat: number }[]> {
  return page.evaluate(() => {
    const ref = (window as any).__BLINDREV__.actions.referencePolygon() as { lon: number; lat: number }[];
    const last = ref[ref.length - 1];
    return ref.length > 3 && ref[0].lon === last.lon && ref[0].lat === last.lat ? ref.slice(0, -1) : ref;
  });
}

export async function availableSteps(page: Page): Promise<{ stepId: string; date: string; index: number }[]> {
  return page.evaluate(() =>
    (window as any).__BLINDREV__.mission.steps
      .map((s: any, i: number) => ({ stepId: s.stepId, date: s.date, index: i, ok: s.isAvailable }))
      .filter((s: any) => s.ok),
  );
}

export async function liveLog(page: Page): Promise<{ t: number; politeness: string; text: string }[]> {
  return page.evaluate(() => (window as any).__liveLog ?? []);
}

/** Focus ring of the focused element: must be a 2 px cyan outline with a non-zero offset (SPEC token: +5 px;
 * the full-viewport map focus target uses an inset -8 px ring — granted exception, see docs/reports/a11y-e2e.md). */
export async function focusRing(page: Page) {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return null;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return {
      tag: el.tagName.toLowerCase(),
      testid: el.getAttribute("data-testid"),
      name: (el.getAttribute("aria-label") ?? el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 60),
      outlineStyle: cs.outlineStyle,
      outlineWidth: cs.outlineWidth,
      outlineColor: cs.outlineColor,
      outlineOffset: cs.outlineOffset,
      boxShadow: cs.boxShadow,
      visible: r.width > 0 && r.height > 0,
      focusVisible: el.matches(":focus-visible"),
    };
  });
}

export function ringOk(f: Awaited<ReturnType<typeof focusRing>>): boolean {
  if (!f) return false;
  return (
    f.visible &&
    f.outlineStyle !== "none" &&
    f.outlineWidth === "2px" &&
    f.outlineColor === CYAN &&
    parseFloat(f.outlineOffset) !== 0
  );
}

/** Press Tab until `target` is focused (keyboard only). Every intermediate focus stop is checked for a ring. */
export async function tabTo(
  page: Page,
  target: Locator,
  opts: { max?: number; shift?: boolean; rings?: unknown[] } = {},
): Promise<void> {
  const max = opts.max ?? 120;
  for (let i = 0; i < max; i++) {
    if (
      await target
        .evaluate((el) => el === document.activeElement || el.contains(document.activeElement))
        .catch(() => false)
    )
      return;
    await page.keyboard.press(opts.shift ? "Shift+Tab" : "Tab");
    const f = await focusRing(page);
    opts.rings?.push(f);
  }
  throw new Error(`tabTo: target not reached in ${max} Tab presses`);
}
