/** Puts the app on each audited screen (offline fixture). */
import type { Page } from "@playwright/test";
import {
  appUrl,
  availableSteps,
  closeOverlays,
  expect,
  openMenu,
  openMission,
  referenceRing,
  waitHarness,
  waitIdle,
} from "./fixtures";

export type ScreenId = "menu" | "hub" | "briefing" | "mission" | "roi-editor" | "verdict" | "journal" | "settings";
export const SCREENS: ScreenId[] = [
  "menu",
  "hub",
  "briefing",
  "mission",
  "roi-editor",
  "verdict",
  "journal",
  "settings",
];

async function markAndPair(page: Page): Promise<void> {
  const av = await availableSteps(page);
  await page.evaluate(
    ([a, b]) => (window as any).__BLINDREV__.actions.selectPair(a, b),
    [av[0].stepId, av[av.length - 1].stepId],
  );
  await page.evaluate((r) => (window as any).__BLINDREV__.actions.setRoi(r, true), await referenceRing(page));
}

export async function gotoScreen(page: Page, id: ScreenId, extra: Record<string, string> = {}): Promise<void> {
  switch (id) {
    case "menu":
      await openMenu(page, extra);
      return;
    case "settings":
      await openMenu(page, extra);
      await page.evaluate(() => (window as any).__BLINDREV__.actions.openOverlay("settings"));
      await expect(page.getByTestId("settings")).toBeVisible();
      return;
    case "hub":
      await page.goto(appUrl({ route: "hub", ...extra }));
      await waitHarness(page);
      await waitIdle(page);
      await expect(page.getByTestId("hub")).toBeVisible();
      return;
    case "briefing":
      await openMission(page, { briefing: "1", ...extra });
      await expect(page.getByTestId("briefing")).toBeVisible();
      return;
    case "mission":
      await openMission(page, extra);
      await closeOverlays(page);
      await page.evaluate(() => (window as any).__BLINDREV__.actions.pause());
      await page.evaluate(() => (window as any).__BLINDREV__.actions.scrubTo(0));
      return;
    case "roi-editor":
      await openMission(page, extra);
      await closeOverlays(page);
      await page.evaluate(() => (window as any).__BLINDREV__.actions.pause());
      await page.evaluate(() => (window as any).__BLINDREV__.actions.scrubTo(0));
      await markAndPair(page);
      await page.getByTestId("open-2d-editor").click();
      await expect(page.getByTestId("roi-editor")).toBeVisible();
      return;
    case "verdict":
      await openMission(page, extra);
      await closeOverlays(page);
      await page.evaluate(() => (window as any).__BLINDREV__.actions.pause());
      await page.evaluate(() => (window as any).__BLINDREV__.actions.scrubTo(0));
      await markAndPair(page);
      await page.getByTestId("validate").click();
      await expect(page.getByTestId("results")).toBeVisible({ timeout: 20_000 });
      return;
    case "journal":
      await gotoScreen(page, "verdict", extra);
      await page.getByTestId("save-journal").click();
      await page.evaluate(() => (window as any).__BLINDREV__.actions.openOverlay("journal"));
      await expect(page.getByTestId("journal")).toBeVisible();
      return;
  }
}
