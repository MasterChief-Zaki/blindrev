/**
 * Spec 4 — prefers-reduced-motion (SPEC §15): immediate route cut (no data tunnel, wipe not animating),
 * auto-play disabled with an explanatory state, stepping still works, mission still completable. GATING.
 */
import type { Page } from "@playwright/test";
import { availableSteps, closeOverlays, expect, openMenu, referenceRing, state, test, waitIdle } from "./fixtures";

/** Watch the next route transition: was the tunnel ever shown, did the wipe ever animate? */
async function armTransitionProbe(page: Page) {
  await page.evaluate(() => {
    const w = window as any;
    w.__rm = { tunnel: false, wipeAnimations: 0, phases: [] as string[], t0: performance.now() };
    const tick = () => {
      if (document.querySelector('[data-testid="data-tunnel"]')) w.__rm.tunnel = true;
      const wipe = document.querySelector('[data-testid="wipe"]') as HTMLElement | null;
      if (wipe) {
        const ph = wipe.getAttribute("data-phase") ?? "";
        if (w.__rm.phases[w.__rm.phases.length - 1] !== ph) w.__rm.phases.push(ph);
        const anims = wipe.getAnimations({ subtree: true }).filter((a) => a.playState === "running");
        // The hex spinner segment may be present but must be still; count only clip-path / transform travel.
        const travelling = anims.filter((a) => {
          const k = (a.effect as KeyframeEffect | null)?.getKeyframes?.() ?? [];
          return k.some((f) => "clipPath" in f || "transform" in f || "clip-path" in f);
        });
        w.__rm.wipeAnimations += travelling.length;
      }
      if (performance.now() - w.__rm.t0 < 15_000) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

async function checkReducedMission(page: Page) {
  // Auto-play is off with its explanatory, focusable state.
  const play = page.getByTestId("timeline-play");
  await expect(play).toHaveAttribute("data-reduced-motion", "true");
  await expect(play).toHaveAttribute("aria-disabled", "true");
  await expect(play).toContainText(/Auto-play is off/i);
  // aria-disabled explanatory control: activating it must not start a sweep.
  await play.click({ force: true });
  await page.waitForTimeout(1500);
  expect((await state(page)).watch.state).not.toBe("PLAYING");

  // Stepping still works.
  const i0 = (await state(page)).watch.index;
  await page.getByTestId("timeline-forward").click();
  await expect.poll(async () => (await state(page)).watch.index).toBe(i0 + 1);

  // Still completable.
  const av = await availableSteps(page);
  await page.getByTestId(`timeline-pair-a-${av[0].index}`).click();
  await page.getByTestId(`timeline-pair-b-${av[av.length - 1].index}`).click();
  await page.evaluate((r) => (window as any).__BLINDREV__.actions.setRoi(r, true), await referenceRing(page));
  await page.getByTestId("validate").click();
  await expect(page.getByTestId("results")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("verdict-tier")).toContainText("PASS");
}

test.describe("emulated prefers-reduced-motion: reduce", () => {
  test.use({ contextOptions: { reducedMotion: "reduce" } });

  test("route cut is immediate, auto-play off, stepping works, mission completable", async ({ page }) => {
    await openMenu(page);
    await expect(page.locator("html")).toHaveClass(/br-reduced-motion/);
    await page.getByTestId("menu-new").click();
    await waitIdle(page);
    await expect(page.getByTestId("hub")).toBeVisible();

    await armTransitionProbe(page);
    const t0 = Date.now();
    await page.getByTestId("open-briefing").click();
    await waitIdle(page);
    await expect(page.getByTestId("mission")).toBeVisible();
    const elapsed = Date.now() - t0;
    const probe = await page.evaluate(() => (window as any).__rm);
    test.info().annotations.push({
      type: "transition",
      description: `phases ${probe.phases.join("→")} · ${elapsed} ms · tunnel ${probe.tunnel}`,
    });
    expect(probe.tunnel, "data tunnel shown under reduced motion").toBe(false);
    expect(probe.wipeAnimations, "wipe clip-path/transform animation running under reduced motion").toBe(0);
    // Under reduced motion the data-tunnel minimum (1.2 s) must not apply.
    expect(elapsed).toBeLessThan(1200);

    await closeOverlays(page);
    await checkReducedMission(page);
  });
});

test("?motion=reduced override (no OS preference) behaves the same", async ({ page }) => {
  await openMenu(page, { motion: "reduced" });
  await expect(page.locator("html")).toHaveClass(/br-reduced-motion/);
  await page.getByTestId("menu-new").click();
  await waitIdle(page);
  await armTransitionProbe(page);
  await page.getByTestId("open-briefing").click();
  await waitIdle(page);
  const probe = await page.evaluate(() => (window as any).__rm);
  expect(probe.tunnel).toBe(false);
  expect(probe.wipeAnimations).toBe(0);
  await closeOverlays(page);
  await checkReducedMission(page);
});
