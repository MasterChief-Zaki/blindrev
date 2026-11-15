/**
 * Spec 8 — contrast spot-check of HUD text against its resolved scrim/panel background (≥ 4.5:1).
 * Spec 9 — 200 % root text size: no clipped text in buttons/panels, primary actions reachable. GATING.
 *
 * Contrast: the background is resolved up the DOM, compositing semi-transparent layers. Where no opaque layer
 * exists (text over the map / scene), the "worst" ratio composites the scrim stack over pure white — the
 * brightest imagery possible — and the "nominal" one over Ink #0E1020. Both are recorded; the assertion uses
 * the worst case for text over imagery and the nominal case for text on opaque panels.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Page } from "@playwright/test";
import { contrastRows } from "./a11y-audit";
import { expect, test } from "./fixtures";
import { gotoScreen } from "./screens";

const OUT = resolve(process.cwd(), "test-results/a11y-e2e");

for (const [screen, root] of [
  ["mission", '[data-testid="mission"]'],
  ["hub", '[data-testid="hub"]'],
] as const) {
  test(`contrast ≥ 4.5:1 on ${screen} HUD text`, async ({ page }) => {
    await gotoScreen(page, screen);
    await page.waitForTimeout(400);
    const rows = await contrastRows(page, screen, root);
    expect(rows.length).toBeGreaterThan(5);
    const judged = rows.map((r) => ({ ...r, ratio: r.overImagery ? r.ratioWorst : r.ratioNominal }));
    const fails = judged.filter((r) => !r.exempt && r.ratio < 4.5);
    mkdirSync(OUT, { recursive: true });
    writeFileSync(resolve(OUT, `contrast-${screen}.json`), JSON.stringify({ screen, rows: judged, fails }, null, 2));
    expect
      .soft(
        fails.map(
          (r) =>
            `"${r.text}" [${r.testid}] ${r.fontPx}px fg ${r.fg} on ${r.bgNominal}${r.overImagery ? " (over imagery, worst case)" : ""} = ${r.ratio}:1`,
        ),
      )
      .toEqual([]);
  });
}

async function zoomAudit(page: Page) {
  return page.evaluate(() => {
    const before = parseFloat(getComputedStyle(document.body).fontSize);
    document.documentElement.style.fontSize = "200%";
    const after = parseFloat(getComputedStyle(document.body).fontSize);
    const clipped: {
      tag: string;
      testid: string | null;
      text: string;
      scrollW: number;
      clientW: number;
      overflow: string;
    }[] = [];
    const sel =
      "button, [role=button], .br-btn, .br-panel, .br-panel *, [role=dialog] *, .br-badge, .br-tab, label, h1, h2, h3, p";
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(sel))) {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      if (r.width < 2 || r.height < 2 || cs.visibility === "hidden" || el.closest("[inert], .br-visually-hidden"))
        continue;
      // Visually hidden until focused (e.g. the transcript toggle): not visible text; its focused state is checked below.
      if (cs.clip === "rect(0px, 0px, 0px, 0px)" || el.parentElement?.closest("[style*=clip]")) continue;
      if (!(el.textContent ?? "").trim()) continue;
      const isControl = el.matches("button, [role=button], .br-btn, .br-badge, .br-tab");
      const clips = cs.overflowX !== "visible" || cs.textOverflow === "ellipsis";
      if (!isControl && !clips) continue;
      if (cs.overflowX === "auto" || cs.overflowX === "scroll") continue; // scrollable, not clipped
      if (el.scrollWidth > el.clientWidth + 1)
        clipped.push({
          tag: el.tagName.toLowerCase(),
          testid: el.getAttribute("data-testid") ?? el.closest("[data-testid]")?.getAttribute("data-testid") ?? null,
          text: (el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 50),
          scrollW: el.scrollWidth,
          clientW: el.clientWidth,
          overflow: cs.overflowX,
        });
    }
    return { before, after, clipped };
  });
}

async function reachable(page: Page, testid: string) {
  const loc = page.getByTestId(testid);
  await loc.scrollIntoViewIfNeeded();
  return loc.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const cx = r.x + r.width / 2;
    const cy = r.y + r.height / 2;
    const top = document.elementFromPoint(cx, cy);
    return {
      inViewport: r.top >= 0 && r.left >= 0 && r.bottom <= innerHeight && r.right <= innerWidth,
      onTop: !!top && (top === el || el.contains(top)),
      w: r.width,
      h: r.height,
    };
  });
}

for (const [screen, primary] of [
  ["menu", "menu-new"],
  ["briefing", "start-investigation"],
  ["mission", "validate"],
] as const) {
  test(`200 % text: no clipped text, primary action reachable — ${screen}`, async ({ page }) => {
    await gotoScreen(page, screen);
    const z = await zoomAudit(page);
    await page.waitForTimeout(300);
    const z2 = await zoomAudit(page); // after layout settles
    const reach = await reachable(page, primary);
    if (screen === "mission") {
      // The skip-style transcript toggle becomes visible on focus: it must not clip at 200 % either.
      const t = page.locator(".sr-summary__toggle");
      await t.focus();
      const m = await t.evaluate((el) => ({
        sw: el.scrollWidth,
        cw: el.clientWidth,
        sh: el.scrollHeight,
        ch: el.clientHeight,
      }));
      expect
        .soft(m.sw <= m.cw + 1 && m.sh <= m.ch + 1, `focused transcript toggle clipped at 200 % (${JSON.stringify(m)})`)
        .toBe(true);
    }
    mkdirSync(OUT, { recursive: true });
    writeFileSync(
      resolve(OUT, `zoom-${screen}.json`),
      JSON.stringify(
        { screen, scaled: { before: z.before, after: z.after }, clipped: z2.clipped, primary, reach },
        null,
        2,
      ),
    );
    expect.soft(z.after, "root font-size 200 % actually scales body text").toBeGreaterThan(z.before * 1.5);
    expect
      .soft(
        z2.clipped.map((c) => `${c.testid ?? c.tag} "${c.text}" ${c.scrollW}>${c.clientW}`),
        `clipped text at 200 % on ${screen}`,
      )
      .toEqual([]);
    expect.soft(reach.inViewport && reach.onTop, `${primary} reachable at 200 % (${JSON.stringify(reach)})`).toBe(true);
  });
}
