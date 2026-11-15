/**
 * Spec 1 — keyboard-only ROI editing (SPEC §10, §15). GATING.
 * No mouse / pointer / click calls anywhere in this file: navigation, ROI building, nudging, date pair,
 * Validate and reading the verdict are all keyboard. The harness is used read-only (state snapshots).
 */
import { expect, focusRing, openMenu, ringOk, state, tabTo, test, waitIdle } from "./fixtures";

const EPS = 1e-9;

test("keyboard-only: menu → mission → 2D ROI editor → nudge → pair → validate → verdict", async ({ page }) => {
  const rings: unknown[] = [];
  // null = Tab moved focus out of the document (to browser chrome) after the last control — not an app stop.
  const badRing = () => rings.filter((r) => r !== null && !ringOk(r as never));

  await openMenu(page);
  // Menu: New Expedition is focused on load (MenuList autoFocus) → Enter.
  await expect(page.getByTestId("menu-new")).toBeFocused();
  rings.push(await focusRing(page));
  await page.keyboard.press("Enter");
  await waitIdle(page);
  await expect(page.getByTestId("hub")).toBeVisible();

  // Hub → case briefing.
  await tabTo(page, page.getByTestId("open-briefing"), { rings });
  rings.push(await focusRing(page));
  await page.keyboard.press("Enter");
  await waitIdle(page);
  await expect(page.getByTestId("briefing")).toBeVisible({ timeout: 30_000 });
  await tabTo(page, page.getByTestId("start-investigation"), { rings });
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("briefing")).toBeHidden();
  await expect(page.getByTestId("mission")).toBeVisible();

  // Open the 2D ROI editor.
  await tabTo(page, page.getByTestId("open-2d-editor"), { rings });
  await page.keyboard.press("Enter");
  const editor = page.getByTestId("roi-editor");
  await expect(editor).toBeVisible();
  await tabTo(page, page.getByTestId("roi-canvas"), { rings });

  // Build a square with the keyboard cursor (Shift+arrow = 1/10 of the span per press).
  const press = async (k: string, n: number) => {
    for (let i = 0; i < n; i++) await page.keyboard.press(k);
  };
  await page.keyboard.press("Enter");
  await press("Shift+ArrowRight", 2);
  await page.keyboard.press("Enter");
  await press("Shift+ArrowDown", 2);
  await page.keyboard.press("Enter");
  await press("Shift+ArrowLeft", 2);
  await page.keyboard.press("Enter");
  await expect(page.locator('[data-testid^="roi-vertex-"]')).toHaveCount(4);
  await page.keyboard.press("c");
  await expect(editor).toHaveAttribute("data-closed", "true");
  await expect(editor).toHaveAttribute("data-status", "valid");

  // Select a vertex with ] and nudge it: arrow = 0.001°, Shift+arrow = 0.01°.
  await page.keyboard.press("]");
  const sel = (await state(page)).mission.selectedIndex as number;
  expect(sel).not.toBeNull();
  const before = (await state(page)).mission.vertices[sel];
  await page.keyboard.press("ArrowRight");
  const afterFine = (await state(page)).mission.vertices[sel];
  expect(Math.abs(afterFine.lon - before.lon - 0.001)).toBeLessThan(EPS);
  expect(Math.abs(afterFine.lat - before.lat)).toBeLessThan(EPS);
  await page.keyboard.press("Shift+ArrowUp");
  const afterCoarse = (await state(page)).mission.vertices[sel];
  expect(Math.abs(afterCoarse.lat - afterFine.lat - 0.01)).toBeLessThan(EPS);
  expect(Math.abs(afterCoarse.lon - afterFine.lon)).toBeLessThan(EPS);
  // The points table shows the nudged value (4 dp).
  await expect(page.getByTestId(`roi-lon-${sel}`)).toHaveValue(afterCoarse.lon.toFixed(4));
  await expect(editor).toHaveAttribute("data-status", "valid");

  // Esc deselects, Esc again closes the editor modal.
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await expect(editor).toBeHidden();
  const s1 = await state(page);
  expect(s1.mission.closed).toBe(true);
  expect(s1.mission.validation.ok).toBe(true);

  // Date pair on the timeline by keyboard: Home → A, End → B.
  await tabTo(page, page.getByTestId("timeline-track"), { rings });
  await page.keyboard.press("Home");
  await page.keyboard.press("a");
  await page.keyboard.press("End");
  await page.keyboard.press("b");
  const s2 = await state(page);
  expect(s2.pairStatus.ok).toBe(true);
  expect(s2.mission.pair.a).not.toBe(s2.mission.pair.b);

  // Validate by keyboard and read the verdict.
  await expect(page.getByTestId("validate")).toBeEnabled();
  await tabTo(page, page.getByTestId("validate"), { rings });
  rings.push(await focusRing(page));
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("results")).toBeVisible({ timeout: 20_000 });
  const verdict = (await page.getByTestId("results").innerText()).replace(/\s+/g, " ");
  expect(verdict).toMatch(/PASS|PARTIAL|FAIL|coherence|Rejected|QA/i);
  const outcome = (await state(page)).mission.outcome;
  expect(outcome).not.toBeNull();
  test
    .info()
    .annotations.push({ type: "verdict", description: `${outcome.kind} ${outcome.tier ?? outcome.code ?? ""}` });

  // Focus was always visible: every Tab stop had a focused element with the 2 px cyan outline + offset.
  expect(rings.length).toBeGreaterThan(3);
  expect(badRing(), "focus stops without the 2 px cyan outline (with offset)").toEqual([]);
});
