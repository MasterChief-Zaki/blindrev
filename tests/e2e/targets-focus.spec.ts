/**
 * Spec 7 — target size (≥ 44×44 CSS px, SPEC §15) + focus ring audit on every screen. GATING.
 * Results (every element measured) are written to test-results/a11y-e2e/targets-<screen>.json.
 *
 * Granted exceptions (WCAG 2.2 2.5.8):
 *  - inline links inside running text (`a[href]` with display:inline in a text block);
 *  - EXCEPTIONS below: none granted yet — each one must name the element and the justification.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { collectTargets, tabWalk } from "./a11y-audit";
import { expect, test } from "./fixtures";
import { gotoScreen, SCREENS } from "./screens";

const OUT = resolve(process.cwd(), "test-results/a11y-e2e");
const EXCEPTIONS: { screen: string; testid?: string; name?: RegExp; why: string }[] = [];

for (const screen of SCREENS) {
  test(`targets ≥ 44×44 and visible focus on Tab — ${screen}`, async ({ page }) => {
    await gotoScreen(page, screen);
    await page.waitForTimeout(300);
    const targets = await collectTargets(page);
    expect(targets.length).toBeGreaterThan(0);

    const granted: unknown[] = [];
    const small = targets.filter((t) => t.w < 44 || t.h < 44);
    const offenders = small.filter((t) => {
      if (t.inlineLink) {
        granted.push({ ...t, why: "inline link in text (WCAG 2.5.8 inline exception)" });
        return false;
      }
      const ex = EXCEPTIONS.find(
        (e) =>
          e.screen === screen && (e.testid ? e.testid === t.testid : true) && (e.name ? e.name.test(t.name) : true),
      );
      if (ex) {
        granted.push({ ...t, why: ex.why });
        return false;
      }
      return true;
    });
    const focusableInAriaHidden = targets.filter((t) => t.inAriaHidden && t.tabindex !== "-1");

    // Tab walk: every tabbable target is reached and shows the ring.
    const stops = await tabWalk(page, targets.length + 25);
    const reached = new Set(stops.map((s) => s.key));
    const tabbable = targets.filter((t) => t.tabindex !== "-1" && !t.offscreen);
    // Composite widgets (Tabs, MenuList) use roving tabindex: only the active item is a Tab stop.
    const unreached = tabbable.filter((t) => !reached.has(t.key) && !/\[role=tab\]/.test(t.tag));
    const badRings = stops.filter((s) => !s.ok);

    mkdirSync(OUT, { recursive: true });
    writeFileSync(
      resolve(OUT, `targets-${screen}.json`),
      JSON.stringify(
        { screen, targets, offenders, granted, unreached, badRings, stops, focusableInAriaHidden },
        null,
        2,
      ),
    );

    expect
      .soft(
        offenders.map((t) => `${t.testid ?? t.tag} "${t.name}" ${t.w}×${t.h}`),
        `targets < 44×44 on ${screen}`,
      )
      .toEqual([]);
    expect
      .soft(
        focusableInAriaHidden.map((t) => `${t.testid ?? t.tag} "${t.name}"`),
        `focusable controls inside aria-hidden on ${screen}`,
      )
      .toEqual([]);
    expect
      .soft(
        unreached.map((t) => `${t.testid ?? t.tag} "${t.name}"`),
        `targets not reachable by Tab on ${screen}`,
      )
      .toEqual([]);
    expect
      .soft(
        badRings.map((s) => `${s.testid ?? ""} "${s.name}" ${JSON.stringify(s.ring)}`),
        `focus stops without the 2 px cyan ring on ${screen}`,
      )
      .toEqual([]);
  });
}
