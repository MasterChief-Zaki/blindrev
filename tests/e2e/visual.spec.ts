/**
 * Spec 10 — visual suite on the offline deterministic fixture (?stub=1&offline=1, fixed clock), 1920×1080,
 * maxDiffPixelRatio 0.02, animations disabled, caret hidden, fonts loaded. GATING.
 * Baselines: tests/e2e/__screenshots__/. Captured during an in-progress layout pass — refresh with
 * `pnpm e2e --update-snapshots` once the layout settles.
 */
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { gotoScreen } from "./screens";

async function settle(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  await page.addStyleTag({
    content:
      "*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}",
  });
  await page.mouse.move(0, 0);
  await page.waitForTimeout(600);
}

const opts = { maxDiffPixelRatio: 0.02, animations: "disabled" as const, caret: "hide" as const, fullPage: false };

test("visual: menu", async ({ page }) => {
  await gotoScreen(page, "menu");
  await settle(page);
  await expect(page).toHaveScreenshot("menu.png", opts);
});

test("visual: hub (?hub=2d)", async ({ page }) => {
  await gotoScreen(page, "hub", { hub: "2d" });
  await settle(page);
  await expect(page).toHaveScreenshot("hub-2d.png", opts);
});

test("visual: mission (stub globe, step 0)", async ({ page }) => {
  await gotoScreen(page, "mission");
  await settle(page);
  await expect(page).toHaveScreenshot("mission-step0.png", opts);
});

test("visual: 2D ROI editor with the reference ROI", async ({ page }) => {
  await gotoScreen(page, "roi-editor");
  await settle(page);
  await expect(page).toHaveScreenshot("roi-editor.png", opts);
});

test("visual: verdict", async ({ page }) => {
  await gotoScreen(page, "verdict");
  await settle(page);
  await expect(page).toHaveScreenshot("verdict.png", opts);
});
