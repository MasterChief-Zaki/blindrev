/**
 * Spec 5 — honesty labels (SPEC §13, §10, §11). GATING.
 */
import {
  appUrl,
  availableSteps,
  closeOverlays,
  expect,
  NOW_STALE,
  openMission,
  referenceRing,
  state,
  test,
  waitHarness,
  waitIdle,
} from "./fixtures";

const DISCLAIMER = "Mission scoring against an authored reference mask — not a scientific measurement.";

test("SIMULATED badge (icon + word) in briefing and mission HUD; verdict disclaimer; offline/ellipsoid status; NISAR propagated", async ({
  page,
}) => {
  await openMission(page, { briefing: "1" });
  const dialog = page.getByRole("dialog");
  await expect(page.getByTestId("briefing")).toBeVisible();
  const bBadge = dialog.getByTestId("badge-SIMULATED").first();
  await expect(bBadge).toBeVisible();
  await expect(bBadge).toContainText("SIMULATED");
  await expect(bBadge.locator("svg")).toHaveCount(1);
  await closeOverlays(page);

  const hud = page.getByTestId("mission");
  const mBadge = hud.getByTestId("badge-SIMULATED").first();
  await expect(mBadge).toBeVisible();
  await expect(mBadge).toContainText("SIMULATED");
  await expect(mBadge.locator("svg")).toHaveCount(1);

  // Offline / no ion token: OFFLINE badge + ellipsoid terrain status.
  await expect(hud.getByTestId("badge-OFFLINE")).toBeVisible();
  await expect(hud).toContainText("Ellipsoid terrain — no ion token");

  await expect(hud.getByTestId("badge-STALE_EPHEMERIS")).toHaveCount(0);

  // Verdict disclaimer.
  const av = await availableSteps(page);
  await page.evaluate(
    ([a, b]) => (window as any).__BLINDREV__.actions.selectPair(a, b),
    [av[0].stepId, av[av.length - 1].stepId],
  );
  await page.evaluate((r) => (window as any).__BLINDREV__.actions.setRoi(r, true), await referenceRing(page));
  await page.getByTestId("validate").click();
  await expect(page.getByTestId("results")).toContainText(DISCLAIMER);
});

test("NISAR panel (hub): propagated, not live telemetry; fresh clock → no STALE_EPHEMERIS", async ({ page }) => {
  await page.goto(appUrl({ route: "hub" }));
  await waitHarness(page);
  await waitIdle(page);
  const nisar = page.getByTestId("nisar-panel");
  await expect(nisar).toBeVisible();
  await expect(nisar).toContainText(/propagated/i);
  await expect(nisar).toContainText(/not live telemetry/i);
  await expect(nisar.getByTestId("badge-STALE_EPHEMERIS")).toHaveCount(0);
});

test("NISAR shows STALE_EPHEMERIS when the clock is > 72 h past the TLE epoch (hub panel + mission HUD)", async ({
  page,
}) => {
  await page.goto(appUrl({ route: "hub", now: NOW_STALE }));
  await waitHarness(page);
  await waitIdle(page);
  const nisar = page.getByTestId("nisar-panel");
  await expect(nisar).toBeVisible();
  const stale = nisar.getByTestId("badge-STALE_EPHEMERIS");
  await expect(stale).toBeVisible();
  await expect(stale).toContainText("STALE_EPHEMERIS");
  await expect(nisar).toContainText(/not live telemetry/i);
  expect((await state(page)).tle.stale).toBe(true);
  await page.evaluate(() => (window as any).__BLINDREV__.actions.goTo("mission"));
  await waitIdle(page);
  await closeOverlays(page);
  await expect(page.getByTestId("mission").getByTestId("badge-STALE_EPHEMERIS")).toBeVisible();
});
