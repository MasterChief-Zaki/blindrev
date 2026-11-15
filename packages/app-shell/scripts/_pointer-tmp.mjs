import { chromium } from "playwright";
const out = process.argv[2];
const b = await chromium.launch({
  args: ["--use-angle=d3d11", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
const errs = [];
p.on("pageerror", (e) => errs.push(String(e)));
p.on("console", (m) => m.type() === "error" && errs.push(m.text()));
await p.goto("http://localhost:5192/?route=mission");
await p.waitForTimeout(7000);
await p.click("[data-testid=reset-view]");
await p.waitForTimeout(3500);
const st = () =>
  p.evaluate(() => {
    const t = document.querySelector("[data-testid=roi-toolbar]");
    const stats = [...(t?.querySelectorAll(".roi-bar__stats *") ?? [])]
      .filter((e) => !e.children.length)
      .map((e) => e.textContent)
      .join(" ");
    return {
      stats,
      mark: document.querySelector("[data-testid=mark-on-globe]")?.textContent,
      sel: t?.querySelector(".roi-bar__sel")?.textContent?.slice(0, 40) ?? null,
      errs: t?.querySelector(".roi-bar__errors")?.textContent ?? null,
    };
  });
console.log("snapshot", (await p.evaluate(() => JSON.stringify(window.__BLINDREV__.state()))).slice(0, 500));
console.log("initial", JSON.stringify(await st()));
await p.click("[data-testid=mark-on-globe]");
console.log("draw on", JSON.stringify(await st()));
const cursor = await p.evaluate(() => getComputedStyle(document.querySelector(".br-globe-root canvas")).cursor);
console.log(
  "cursor",
  cursor,
  "hint:",
  await p
    .locator("[data-testid=draw-hint]")
    .innerText()
    .catch(() => null),
);
const pts = [
  [800, 220],
  [960, 230],
  [950, 350],
  [830, 360],
];
for (const [x, y] of pts) {
  await p.mouse.move(x, y, { steps: 4 });
  await p.mouse.down();
  await p.mouse.up();
  await p.waitForTimeout(250);
  console.log("click", x, y, JSON.stringify(await st()));
}
await p.mouse.move(900, 300, { steps: 5 });
await p.waitForTimeout(300);
console.log(
  "probe:",
  await p.evaluate(() => {
    const e = document.querySelector("[data-testid=probe-chip]");
    return e ? [e.hidden, e.innerText] : null;
  }),
);
await p.screenshot({ path: out + "/1080-03-draw-open.png" });
console.log(
  "hint:",
  await p
    .locator("[data-testid=draw-hint]")
    .innerText()
    .catch(() => null),
);
await p.keyboard.press("Backspace");
await p.waitForTimeout(200);
console.log("after Backspace", JSON.stringify(await st()));
await p.mouse.click(830, 360);
await p.waitForTimeout(250);
console.log("re-add", JSON.stringify(await st()));
await p.mouse.move(800, 220, { steps: 5 });
await p.waitForTimeout(200);
await p.mouse.click(800, 220);
await p.waitForTimeout(400);
console.log("click first corner", JSON.stringify(await st()));
await p.screenshot({ path: out + "/1080-04-draw-closed.png" });
// drag a corner
await p.mouse.move(960, 230, { steps: 3 });
await p.mouse.down();
await p.mouse.move(1000, 200, { steps: 6 });
await p.mouse.up();
await p.waitForTimeout(300);
console.log("after drag corner", JSON.stringify(await st()));
await p.keyboard.press("Escape");
await p.waitForTimeout(200);
console.log("after Esc", JSON.stringify(await st()));
console.log("errors", JSON.stringify(errs.slice(0, 6)));
await b.close();
