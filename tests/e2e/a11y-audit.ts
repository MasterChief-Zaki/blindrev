/** In-page audit helpers shared by the target-size / focus / contrast / zoom specs. */
import type { Page } from "@playwright/test";
import { CYAN } from "./fixtures";

export const INTERACTIVE = 'button, a[href], input, select, [role=button], [role=tab], [role=slider], [tabindex="0"]';

export interface Target {
  key: string;
  tag: string;
  testid: string | null;
  name: string;
  w: number;
  h: number;
  x: number;
  y: number;
  inlineLink: boolean;
  tabindex: string | null;
  inAriaHidden: boolean;
  offscreen: boolean;
}

/** Visible, enabled, non-inert interactive elements, each tagged with data-e2e-key. */
export async function collectTargets(page: Page): Promise<Target[]> {
  return page.evaluate((sel) => {
    let n = 0;
    const out: Target[] = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(sel))) {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      if (r.width < 2 || r.height < 2 || cs.visibility === "hidden" || cs.display === "none") continue;
      if (el.closest("[inert]")) continue;
      if ((el as HTMLButtonElement).disabled) continue;
      // Visually-hidden (sr-only) helpers are not pointer targets.
      if (cs.clip === "rect(0px, 0px, 0px, 0px)" || cs.clipPath === "inset(50%)") continue;
      let o: HTMLElement | null = el;
      let hidden = false;
      while (o) {
        if (getComputedStyle(o).opacity === "0") hidden = true;
        o = o.parentElement;
      }
      if (hidden) continue;
      const key = `e${n++}`;
      el.setAttribute("data-e2e-key", key);
      const label =
        el.getAttribute("aria-label") ??
        (el.getAttribute("aria-labelledby")
          ? document.getElementById(el.getAttribute("aria-labelledby") ?? "")?.textContent
          : null) ??
        el.textContent ??
        el.getAttribute("title") ??
        (el as HTMLInputElement).value ??
        "";
      const parentText = (el.parentElement?.textContent ?? "").trim().length;
      out.push({
        key,
        tag:
          el.tagName.toLowerCase() +
          (el.getAttribute("role") ? `[role=${el.getAttribute("role")}]` : "") +
          (el.tagName === "INPUT" ? `[type=${(el as HTMLInputElement).type}]` : ""),
        testid: el.getAttribute("data-testid"),
        name: String(label).trim().replace(/\s+/g, " ").slice(0, 70),
        w: Math.round(r.width * 10) / 10,
        h: Math.round(r.height * 10) / 10,
        x: Math.round(r.x),
        y: Math.round(r.y),
        inlineLink:
          el.tagName === "A" && cs.display === "inline" && parentText > (el.textContent ?? "").trim().length + 10,
        tabindex: el.getAttribute("tabindex"),
        inAriaHidden: !!el.closest("[aria-hidden=true]"),
        offscreen: r.bottom < 0 || r.right < 0 || r.top > innerHeight || r.left > innerWidth,
      });
    }
    return out;
  }, INTERACTIVE);
}

export interface TabStop {
  key: string | null;
  testid: string | null;
  name: string;
  ring: { style: string; width: string; color: string; offset: string } | null;
  ok: boolean;
}

/** Tab through the page from the top; returns the ordered focus stops (stops when focus cycles). */
export async function tabWalk(page: Page, maxStops: number): Promise<TabStop[]> {
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur?.();
    const modal = document.querySelector<HTMLElement>("[role=dialog][aria-modal=true]");
    if (modal) {
      // Start inside the modal: focus the dialog container so Tab enters its first control.
      modal.setAttribute("tabindex", modal.getAttribute("tabindex") ?? "-1");
      modal.focus();
    }
  });
  const stops: TabStop[] = [];
  const seen = new Map<string, number>();
  for (let i = 0; i < maxStops; i++) {
    await page.keyboard.press("Tab");
    const s = await page.evaluate((cyan) => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return null;
      const cs = getComputedStyle(el);
      const ring = { style: cs.outlineStyle, width: cs.outlineWidth, color: cs.outlineColor, offset: cs.outlineOffset };
      return {
        key: el.getAttribute("data-e2e-key"),
        testid: el.getAttribute("data-testid"),
        name: (el.getAttribute("aria-label") ?? el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 60),
        ring,
        ok:
          ring.style !== "none" &&
          ring.width === "2px" &&
          ring.color === cyan &&
          parseFloat(ring.offset) !== 0 &&
          el.matches(":focus-visible"),
      };
    }, CYAN);
    if (!s) continue;
    const id = s.key ?? `${s.testid}|${s.name}`;
    if (seen.has(id) && stops.length > 1) break;
    seen.set(id, i);
    stops.push(s);
  }
  return stops;
}

/* ------------------------------------------------------------------ contrast */

export interface ContrastRow {
  screen: string;
  text: string;
  testid: string | null;
  fontPx: number;
  bold: boolean;
  fg: string;
  bgNominal: string;
  overImagery: boolean;
  ratioNominal: number;
  ratioWorst: number;
  exempt: string | null;
}

/** For each visible text-bearing element under `rootSel`, resolve fg + composed background up the DOM. */
export async function contrastRows(page: Page, screen: string, rootSel: string, limit = 400): Promise<ContrastRow[]> {
  return page.evaluate(
    ({ screen, rootSel, limit }) => {
      const parse = (c: string): [number, number, number, number] => {
        const m = c.match(/rgba?\(([^)]+)\)/);
        if (!m) return [0, 0, 0, 0];
        const p = m[1]
          .split(/[ ,/]+/)
          .filter(Boolean)
          .map(Number);
        return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
      };
      const lin = (v: number) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      const L = (c: number[]) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
      const over = (top: number[], bot: number[]) => {
        const a = top[3];
        return [top[0] * a + bot[0] * (1 - a), top[1] * a + bot[1] * (1 - a), top[2] * a + bot[2] * (1 - a), 1];
      };
      const ratio = (a: number[], b: number[]) => {
        const la = L(a);
        const lb = L(b);
        return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
      };
      const INK = [14, 16, 32, 1];
      const WHITE = [255, 255, 255, 1];
      const root = document.querySelector(rootSel);
      const rows: ContrastRow[] = [];
      if (!root) return rows;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      const done = new Set<Element>();
      let node: Node | null;
      while ((node = walker.nextNode()) && rows.length < limit) {
        const t = (node.textContent ?? "").trim();
        if (!t) continue;
        const el = node.parentElement;
        if (!el || done.has(el)) continue;
        done.add(el);
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        if (
          r.width < 1 ||
          r.height < 1 ||
          cs.visibility === "hidden" ||
          el.closest("[aria-hidden=true] svg, .br-visually-hidden, [inert]")
        )
          continue;
        if (cs.clip === "rect(0px, 0px, 0px, 0px)") continue;
        // Composite layers from the element up; stop at the first opaque layer.
        const layers: number[][] = [];
        let opaque = false;
        let imageBg = false;
        let op = 1;
        for (let a: Element | null = el; a; a = a.parentElement) {
          const s = getComputedStyle(a);
          op *= Number(s.opacity);
          if (s.backgroundImage && s.backgroundImage !== "none" && !s.backgroundImage.startsWith("linear-gradient"))
            imageBg = true;
          const bg = parse(s.backgroundColor);
          if (bg[3] > 0) {
            layers.push(bg);
            if (bg[3] >= 0.999) {
              opaque = true;
              break;
            }
          }
        }
        const compose = (base: number[]) => layers.reduceRight((acc, l) => over(l, acc), base);
        const fg0 = parse(cs.color);
        const bgN = compose(INK);
        const bgW = opaque ? bgN : compose(WHITE);
        const fgN = over([fg0[0], fg0[1], fg0[2], fg0[3] * op], bgN);
        const fgW = over([fg0[0], fg0[1], fg0[2], fg0[3] * op], bgW);
        const fontPx = parseFloat(cs.fontSize);
        const bold = Number(cs.fontWeight) >= 700;
        const inactive = el.closest("[aria-disabled=true], :disabled, .is-locked, [data-status=locked]");
        rows.push({
          screen,
          text: t.slice(0, 50),
          testid: el.closest("[data-testid]")?.getAttribute("data-testid") ?? null,
          fontPx,
          bold,
          fg: cs.color,
          bgNominal: `rgb(${bgN.slice(0, 3).map(Math.round).join(", ")})`,
          overImagery: !opaque || imageBg,
          ratioNominal: Math.round(ratio(fgN, bgN) * 100) / 100,
          ratioWorst: Math.round(ratio(fgW, bgW) * 100) / 100,
          exempt: inactive ? "inactive control (WCAG 1.4.3 exemption)" : null,
        });
      }
      return rows;
    },
    { screen, rootSel, limit },
  );
}
