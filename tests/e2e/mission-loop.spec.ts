/**
 * Spec 2 — full mission loop + the known scoring cases from docs/reports/spike-B-data.md. GATING.
 */
import type { Page } from "@playwright/test";
import {
  availableSteps,
  expect,
  openMenu,
  openMission,
  closeOverlays,
  referenceRing,
  state,
  test,
  waitIdle,
} from "./fixtures";

const QA_MSG = "Low interferometric coherence in selected zone; inspect high-coherence mask";

/** gate-b case "persistent low-coherence zone (west)": circle(-120.255, 36.175, 4 km) — packages/data-forge/src/gate-b.ts. */
function circle(lon: number, lat: number, rKm: number, n = 48): { lon: number; lat: number }[] {
  const dLat = rKm / 111.32;
  const dLon = rKm / (111.32 * Math.cos((lat * Math.PI) / 180));
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * 2 * Math.PI;
    return { lon: lon + dLon * Math.cos(a), lat: lat + dLat * Math.sin(a) };
  });
}

async function setRoi(page: Page, ring: { lon: number; lat: number }[]) {
  await page.evaluate((r) => (window as any).__BLINDREV__.actions.setRoi(r, true), ring);
}
async function pair(page: Page, a: string, b: string) {
  await page.evaluate(([x, y]) => (window as any).__BLINDREV__.actions.selectPair(x, y), [a, b]);
}

test("full loop: briefing → watch → pair → ROI → validate → verdict → journal (persists) → hub", async ({ page }) => {
  await openMenu(page);
  await page.getByTestId("menu-new").click();
  await waitIdle(page);
  await expect(page.getByTestId("hub")).toBeVisible();
  await page.getByTestId("open-briefing").click();
  await waitIdle(page);

  // Briefing.
  const briefing = page.getByTestId("briefing");
  await expect(briefing).toBeVisible({ timeout: 30_000 });
  await expect(briefing).toContainText(/CASE #001/);
  await page.getByTestId("start-investigation").click();
  await expect(briefing).toBeHidden();

  // Watch: auto-play must skip unavailable steps (never rest on one while PLAYING) and emit the skip chip.
  const steps = await page.evaluate(() =>
    (window as any).__BLINDREV__.mission.steps.map((s: any) => ({ id: s.stepId, ok: s.isAvailable })),
  );
  const unavailable = steps.map((s: any, i: number) => (s.ok ? -1 : i)).filter((i: number) => i >= 0);
  expect(unavailable.length).toBeGreaterThan(0);
  const s0 = await state(page);
  if (s0.watch.state !== "PLAYING") await page.evaluate(() => (window as any).__BLINDREV__.actions.play());
  const samples = await page.evaluate(async () => {
    const out: any[] = [];
    const t0 = performance.now();
    while (performance.now() - t0 < 14_000) {
      const s = (window as any).__BLINDREV__.state();
      out.push({ state: s.watch.state, index: s.watch.index, ok: s.watch.isAvailable, chip: s.mission.noAcquisition });
      if (s.watch.state !== "PLAYING" && out.length > 5) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    return out;
  });
  const visited = new Set(samples.filter((x) => x.state === "PLAYING").map((x) => x.index));
  expect(
    samples.filter((x) => x.state === "PLAYING" && !x.ok),
    "PLAYING rested on an unavailable step",
  ).toEqual([]);
  for (const u of unavailable) expect(visited.has(u), `auto-play visited unavailable step ${u}`).toBe(false);
  expect(
    samples.some((x) => x.chip?.skipped),
    "skip chip shown while playing past a gap",
  ).toBe(true);

  // Stepping onto an unavailable step shows the explicit "No acquisition" state.
  await page.evaluate(() => (window as any).__BLINDREV__.actions.pause());
  await page.evaluate((i) => (window as any).__BLINDREV__.actions.scrubTo(i), unavailable[0]);
  const card = page.getByTestId("no-acquisition");
  await expect(card).toBeVisible();
  await expect(card).toContainText("No acquisition");
  expect((await state(page)).watch.state).toBe("PAUSED_UNAVAILABLE");
  await expect(page.getByTestId(`timeline-step-${unavailable[0]}`)).toHaveAttribute("data-available", "false");

  // Pair (UI buttons), ROI = reference polygon, validate → PASS.
  const avail = await availableSteps(page);
  const first = avail[0];
  const last = avail[avail.length - 1];
  await page.getByTestId(`timeline-pair-a-${first.index}`).click();
  await page.getByTestId(`timeline-pair-b-${last.index}`).click();
  expect((await state(page)).pairStatus.ok).toBe(true);
  await setRoi(page, await referenceRing(page));
  await page.getByTestId("validate").click();
  const results = page.getByTestId("results");
  await expect(results).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("verdict-tier")).toContainText("PASS");

  // Save to the Case Journal; it persists after reload.
  await page.getByTestId("save-journal").click();
  await expect(page.getByTestId("save-journal")).toBeDisabled();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("blindrev.journal.v1") ?? "[]"));
  expect(Array.isArray(saved) ? saved.length : Object.keys(saved).length).toBeGreaterThan(0);
  await page.reload();
  await page.waitForFunction(() => !!(window as any).__BLINDREV__);
  await waitIdle(page);
  expect((await state(page)).journalCount).toBeGreaterThan(0);
  await page.evaluate(() => (window as any).__BLINDREV__.actions.openOverlay("journal"));
  const journal = page.getByTestId("journal");
  await expect(journal).toBeVisible();
  await expect(journal.locator(".jrow__head").first()).toContainText("PASS");
  await closeOverlays(page);

  // Return to the hub.
  await page.evaluate(() => (window as any).__BLINDREV__.actions.goTo("mission"));
  await waitIdle(page);
  await expect(page.getByTestId("mission")).toBeVisible();
  await closeOverlays(page);
  await page.getByTestId("return-button").click();
  await waitIdle(page);
  await expect(page.getByTestId("hub")).toBeVisible();
  const lc = (await state(page)).lifecycle;
  expect(lc.live).toBeLessThanOrEqual(1);
});

test.describe("scoring cases (spike-B-data.md)", () => {
  test.beforeEach(async ({ page }) => {
    await openMission(page);
    await closeOverlays(page);
  });

  test("reference polygon scores PASS", async ({ page }) => {
    const av = await availableSteps(page);
    await pair(page, av[0].stepId, av[av.length - 1].stepId);
    await setRoi(page, await referenceRing(page));
    const o = await page.evaluate(() => (window as any).__BLINDREV__.actions.validate());
    expect(o.kind).toBe("SCORE");
    expect(o.tier).toBe("PASS");
    expect(o.iou).toBeGreaterThanOrEqual(0.5);
    test.info().annotations.push({
      type: "score",
      description: `IoU ${o.iou.toFixed(3)} P ${o.precision.toFixed(3)} R ${o.recall.toFixed(3)} digest ${o.digest}`,
    });
    // referencePolygon() is the main-bowl ring; gate-b (offline core-sim run) scored it IoU 0.799, digest ffb9fab1119a….
    expect(o.iou.toFixed(3)).toBe("0.799");
    expect(o.digest.slice(0, 12)).toBe("ffb9fab1119a");
    await expect(page.getByTestId("verdict-tier")).toContainText("PASS");
  });

  test("western low-coherence zone → QA diagnostic", async ({ page }) => {
    const av = await availableSteps(page);
    await pair(page, av[0].stepId, av[av.length - 1].stepId);
    await setRoi(page, circle(-120.255, 36.175, 4));
    expect((await state(page)).validateStatus.ok).toBe(true);
    await page.getByTestId("validate").click();
    await expect(page.getByTestId("results")).toBeVisible({ timeout: 20_000 });
    const o = await page.evaluate(() => (window as any).__BLINDREV__.actions.getOutcome());
    expect(o.kind).toBe("QA_DIAGNOSTIC");
    expect(o.code).toBe("LOW_COHERENCE");
    await expect(page.getByTestId("qa-diagnostic")).toContainText(QA_MSG);
  });

  test("same date twice is rejected", async ({ page }) => {
    const av = await availableSteps(page);
    const last = av[av.length - 1];
    await page.getByTestId(`timeline-pair-a-${last.index}`).click();
    await page.getByTestId(`timeline-pair-b-${last.index}`).click();
    const s = await state(page);
    // Either the UI refuses to put A and B on the same step, or the pair is flagged as invalid.
    const sameStep = s.mission.pair.a !== null && s.mission.pair.a === s.mission.pair.b;
    if (sameStep) {
      expect(s.pairStatus.ok).toBe(false);
      await expect(page.getByTestId("timeline-pair-warning")).toBeVisible();
    } else {
      expect(s.pairStatus.ok).toBe(false);
    }
    // Force the pair through the harness and score: the core must reject Δt = 0.
    await pair(page, last.stepId, last.stepId);
    await setRoi(page, await referenceRing(page));
    const vs = (await state(page)).validateStatus;
    expect(vs.ok).toBe(false);
    await expect(page.getByTestId("validate")).toBeDisabled();
    const o = await page.evaluate(() => (window as any).__BLINDREV__.actions.validate());
    expect(o === null || (o.kind === "REJECTED" && o.code === "DT_TOO_SHORT"), `outcome ${JSON.stringify(o)}`).toBe(
      true,
    );
  });

  test("pair with a no-acquisition step cannot be scored", async ({ page }) => {
    const steps = await page.evaluate(() =>
      (window as any).__BLINDREV__.mission.steps.map((s: any) => ({ id: s.stepId, ok: s.isAvailable })),
    );
    const gap = steps.find((s: any) => !s.ok);
    const av = await availableSteps(page);
    await pair(page, av[0].stepId, gap.id);
    await setRoi(page, await referenceRing(page));
    expect((await state(page)).validateStatus.ok).toBe(false);
    await expect(page.getByTestId("validate")).toBeDisabled();
  });

  test("same ROI + same steps validated twice → identical outcome and digest", async ({ page }) => {
    const av = await availableSteps(page);
    await pair(page, av[0].stepId, av[av.length - 1].stepId);
    const ref = await referenceRing(page);
    // A deliberately imperfect ROI (shifted east) so the digest covers a non-trivial score.
    const ring = ref.map((p) => ({ lon: p.lon + 0.02, lat: p.lat }));
    await setRoi(page, ring);
    const o1 = await page.evaluate(() => (window as any).__BLINDREV__.actions.validate());
    await closeOverlays(page);
    await setRoi(page, ring);
    const o2 = await page.evaluate(() => (window as any).__BLINDREV__.actions.validate());
    expect(o1.kind).toBe("SCORE");
    expect(typeof o1.digest).toBe("string");
    expect(o1.digest.length).toBeGreaterThan(8);
    expect(o2).toEqual(o1);
  });
});
