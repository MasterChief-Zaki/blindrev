/**
 * Spec 3 — live-region announcements (SPEC §15): "No acquisition" and watch (FSM) state changes. GATING.
 */
import { closeOverlays, expect, liveLog, openMission, state, test } from "./fixtures";

test("No acquisition and watch state changes are announced through aria-live hosts", async ({ page }) => {
  await openMission(page);
  await closeOverlays(page);

  // The two app-wide hosts exist and are live.
  await expect(page.getByTestId("live-polite")).toHaveAttribute("aria-live", "polite");
  await expect(page.getByTestId("live-assertive")).toHaveAttribute("aria-live", "assertive");

  const steps = await page.evaluate(() => (window as any).__BLINDREV__.mission.steps.map((s: any) => s.isAvailable));
  const gap = steps.findIndex((ok: boolean) => !ok);
  expect(gap).toBeGreaterThan(0);

  // Watch state change: play.
  await page.evaluate(() => (window as any).__BLINDREV__.actions.pause());
  const n0 = (await liveLog(page)).length;
  await page.evaluate(() => (window as any).__BLINDREV__.actions.play());
  await expect.poll(async () => (await state(page)).watch.state).toBe("PLAYING");
  await expect
    .poll(
      async () =>
        (await liveLog(page))
          .slice(n0)
          .map((e) => e.text)
          .join(" | "),
      { timeout: 8_000 },
    )
    .toMatch(/play|watch|pass|step|\d{4}/i);
  await page.evaluate(() => (window as any).__BLINDREV__.actions.pause());

  // Stepping onto an unavailable step → "No acquisition" announced (assertive per F.md).
  const n1 = (await liveLog(page)).length;
  await page.evaluate((i) => (window as any).__BLINDREV__.actions.scrubTo(i), gap);
  await expect.poll(async () => (await state(page)).watch.state).toBe("PAUSED_UNAVAILABLE");
  await expect
    .poll(
      async () =>
        (await liveLog(page))
          .slice(n1)
          .filter((e) => /no acquisition/i.test(e.text))
          .map((e) => e.politeness),
      { timeout: 5_000 },
    )
    .toContain("assertive");

  // Leaving the gap (step forward to an available step) is a state change too and is announced.
  const n2 = (await liveLog(page)).length;
  await page.evaluate(() => (window as any).__BLINDREV__.actions.step(1));
  await expect.poll(async () => (await liveLog(page)).length, { timeout: 5_000 }).toBeGreaterThan(n2);

  test.info().annotations.push({
    type: "announcements",
    description: (await liveLog(page))
      .map((e) => `[${e.politeness}] ${e.text}`)
      .join(" || ")
      .slice(0, 1500),
  });
});
