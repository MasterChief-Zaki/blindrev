/**
 * Spec 6 — screen-reader mission transcript (SPEC §15): briefing question, every temporal step with its date
 * and availability, ROI coordinates after marking, and the verdict. GATING.
 */
import { availableSteps, closeOverlays, expect, openMission, referenceRing, test } from "./fixtures";

test("DOM mission summary contains briefing, every step + availability, ROI coordinates, verdict", async ({ page }) => {
  await openMission(page);
  await closeOverlays(page);
  const sr = page.getByTestId("sr-summary");
  await expect(sr).toHaveCount(1);
  // Present in the accessibility tree (visually hidden is fine, display:none/aria-hidden is not).
  expect(await sr.evaluate((el) => !el.closest("[aria-hidden=true]") && getComputedStyle(el).display !== "none")).toBe(
    true,
  );

  const m = await page.evaluate(() => {
    const ms = (window as any).__BLINDREV__.mission;
    return {
      question: ms.briefing.question as string,
      steps: ms.steps.map((s: any) => ({ date: s.date as string, ok: s.isAvailable as boolean })),
    };
  });
  const text = async () => ((await sr.textContent()) ?? "").replace(/\s+/g, " ");
  expect(await text()).toContain(m.question);

  // Every step, in order, with its date and availability.
  const items = sr.locator("ol").first().locator("li");
  await expect(items).toHaveCount(m.steps.length);
  for (let i = 0; i < m.steps.length; i++) {
    const t = ((await items.nth(i).textContent()) ?? "").toLowerCase();
    const [y, mo, d] = m.steps[i].date.slice(0, 10).split("-");
    expect(t, `step ${i} year`).toContain(y);
    // Day of month appears (as "05" or "5").
    expect(t.includes(d) || t.includes(String(Number(d))), `step ${i} day`).toBe(true);
    expect(t, `step ${i} availability`).toContain(m.steps[i].ok ? "acquired" : "no acquisition");
    void mo;
  }

  // Mark the ROI → coordinates appear.
  expect(await text()).toContain("No region marked yet");
  const ring = await referenceRing(page);
  const av = await availableSteps(page);
  await page.evaluate(
    ([a, b]) => (window as any).__BLINDREV__.actions.selectPair(a, b),
    [av[0].stepId, av[av.length - 1].stepId],
  );
  await page.evaluate((r) => (window as any).__BLINDREV__.actions.setRoi(r, true), ring);
  const t1 = await text();
  expect(t1).toContain(`${ring.length} corners, closed`);
  for (const v of ring) expect(t1).toContain(`Latitude ${v.lat.toFixed(4)}, longitude ${v.lon.toFixed(4)}`);

  // Verdict.
  expect(t1).toContain("Not validated yet");
  await page.getByTestId("validate").click();
  await expect(page.getByTestId("results")).toBeVisible({ timeout: 20_000 });
  await expect.poll(text).toMatch(/PASS/);
  const t2 = await text();
  expect(t2).toMatch(/Overlap \d\.\d{3}, precision \d\.\d{3}, recall \d\.\d{3}/);
  expect(t2).toContain("not a scientific measurement");
});
