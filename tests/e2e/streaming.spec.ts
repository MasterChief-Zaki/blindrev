/**
 * @streaming — NON-GATING. Real renderers (Cesium globe, Three.js hub), network allowed.
 * Runs only when BLINDREV_STREAMING=1 (see playwright.config.ts): `BLINDREV_STREAMING=1 pnpm e2e --grep @streaming`.
 */
import { expect, NOW, test, waitHarness, waitIdle } from "./fixtures";

test.use({ allowNetwork: true });

test("@streaming real mission globe reaches scene-ready and the 3D hub renders", async ({ page }) => {
  await page.goto(`/?route=mission&now=${encodeURIComponent(NOW)}`);
  await waitHarness(page);
  await waitIdle(page);
  await expect(page.getByTestId("mission")).toBeVisible({ timeout: 60_000 });
  const g = await page.evaluate(() => (window as any).__BLINDREV__.state());
  test.info().annotations.push({
    type: "globe",
    description: JSON.stringify({ scene: g.scene, globeMode: g.globeMode, globeStatus: g.globeStatus }),
  });
  expect(g.scene?.kind).toBe("mission");
  expect(g.scene?.impl).not.toMatch(/stub|2d/);
  expect(g.globeMode, `globe fell back: ${g.globeFallbackReason}`).not.toBe("stub");
  expect(g.globeStatus).not.toBeNull();

  await page.evaluate(() => (window as any).__BLINDREV__.actions.goTo("hub"));
  await waitIdle(page);
  await expect(page.getByTestId("hub")).toBeVisible();
  const h = await page.evaluate(() => (window as any).__BLINDREV__.state());
  test.info().annotations.push({ type: "hub", description: JSON.stringify({ scene: h.scene, hubMode: h.hubMode }) });
  expect(h.scene?.kind).toBe("hub");
  expect(h.scene?.impl).not.toMatch(/stub|2d/);
  expect(h.hubMode, `hub fell back: ${h.hubFallbackReason}`).not.toBe("2d");
  expect(h.lifecycle.live).toBeLessThanOrEqual(1);
});
