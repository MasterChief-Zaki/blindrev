import { KeyHint, Logo, MenuList } from "@blindrev/ui-hud";
import { useEffect, useRef, useState } from "react";
import { env } from "../env";
import { navigate } from "../scene/navigation";
import { useApp, useReducedMotion } from "../store";
import { Plate } from "./Transit";
import "./ux-strike-1.css";

/* Plate-space (1600×900) anchors of the light sources painted into the owner's background plate. */
const STRIPS: { x: number; y0: number; y1: number; rgb: string; ph: number }[] = [
  { x: 151, y0: 171, y1: 285, rgb: "61,224,208", ph: 0 },
  { x: 193, y0: 204, y1: 379, rgb: "224,72,155", ph: 1.7 },
  { x: 1406, y0: 204, y1: 379, rgb: "224,72,155", ph: 3.1 },
  { x: 1448, y0: 171, y1: 285, rgb: "61,224,208", ph: 4.4 },
];
const LAMPS = [
  { x: 268, y: 657 },
  { x: 1331, y: 657 },
];

/** Restrained life for the plate: the pillar light strips breathe, dusk haze drifts along the horizon,
 *  a few dust motes cross the room. Canvas2D at half resolution (no WebGL on this screen); one static
 *  frame under reduced motion. Purely decorative — aria-hidden. */
function MenuAmbience({ still }: { still: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    let raf = 0;
    let W = 0;
    let H = 0;
    let k = 1;
    let ox = 0;
    let oy = 0;
    const resize = () => {
      W = c.width = Math.max(2, Math.round(c.clientWidth / 2));
      H = c.height = Math.max(2, Math.round(c.clientHeight / 2));
      k = Math.max(W / 1600, H / 900); // background-size: cover
      ox = (W - 1600 * k) / 2;
      oy = (H - 900 * k) / 2;
    };
    resize();
    let seed = 0x51ed270b;
    const rnd = () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = seed;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const motes = Array.from({ length: 46 }, () => ({
      x: rnd() * 1600,
      y: 120 + rnd() * 700,
      vx: (rnd() - 0.5) * 7,
      vy: -2 - rnd() * 5,
      r: 0.8 + rnd() * 1.6,
      ph: rnd() * 6.28,
      a: 0.1 + rnd() * 0.22,
    }));
    const haze = [
      { x: 520, y: 560, rx: 420, ry: 70, v: 9, rgb: "108,92,231", a: 0.16 },
      { x: 980, y: 585, rx: 520, ry: 54, v: -6, rgb: "61,224,208", a: 0.09 },
      { x: 800, y: 520, rx: 380, ry: 90, v: 4, rgb: "108,92,231", a: 0.1 },
    ];
    const mapX = (x: number) => ox + x * k;
    const mapY = (y: number) => oy + y * k;
    let last = 0;
    const draw = (now: number) => {
      const t = still ? 0 : now / 1000;
      ctx.clearRect(0, 0, W, H);
      ctx.globalCompositeOperation = "lighter";
      // dusk haze drifting along the horizon, inside the viewport frame
      ctx.save();
      ctx.beginPath();
      ctx.rect(X(300), Y(300), 1000 * k, 302 * k);
      ctx.clip();
      for (const h of haze) {
        const hx = h.x + Math.sin(t * 0.05 * (h.v > 0 ? 1 : -1) + h.x) * 160 + ((t * h.v) % 240);
        const g = ctx.createRadialGradient(X(hx), Y(h.y), 0, X(hx), Y(h.y), h.rx * k);
        const a = h.a * (0.8 + 0.2 * Math.sin(t * 0.21 + h.y));
        g.addColorStop(0, `rgba(${h.rgb},${a.toFixed(3)})`);
        g.addColorStop(1, `rgba(${h.rgb},0)`);
        ctx.save();
        ctx.translate(0, Y(h.y));
        ctx.scale(1, h.ry / h.rx);
        ctx.translate(0, -Y(h.y));
        ctx.fillStyle = g;
        ctx.fillRect(X(hx - h.rx), Y(h.y) - h.rx * k, 2 * h.rx * k, 2 * h.rx * k);
        ctx.restore();
      }
      // the horizon line itself shimmers
      const hl = 0.1 + 0.06 * Math.sin(t * 0.6);
      const hg = ctx.createLinearGradient(0, Y(580), 0, Y(604));
      hg.addColorStop(0, "rgba(61,224,208,0)");
      hg.addColorStop(0.8, `rgba(61,224,208,${hl.toFixed(3)})`);
      hg.addColorStop(1, "rgba(61,224,208,0)");
      ctx.fillStyle = hg;
      ctx.fillRect(X(340), Y(580), 920 * k, 24 * k);
      ctx.restore();
      // pillar light strips breathe (slow, out of phase) + their floor reflections
      for (const s of STRIPS) {
        const b = 0.5 + 0.5 * Math.sin(t * 0.7 + s.ph);
        const a = 0.1 + 0.2 * b;
        const half = 34 * k;
        const g = ctx.createLinearGradient(X(s.x) - half, 0, X(s.x) + half, 0);
        g.addColorStop(0, `rgba(${s.rgb},0)`);
        g.addColorStop(0.5, `rgba(${s.rgb},${a.toFixed(3)})`);
        g.addColorStop(1, `rgba(${s.rgb},0)`);
        ctx.fillStyle = g;
        ctx.fillRect(X(s.x) - half, Y(s.y0 - 10), half * 2, (s.y1 - s.y0 + 20) * k);
        ctx.fillStyle = `rgba(${s.rgb},${(0.25 + 0.4 * b).toFixed(3)})`;
        ctx.fillRect(X(s.x) - 1.2 * k, Y(s.y0), 2.4 * k, (s.y1 - s.y0) * k);
        const fg = ctx.createRadialGradient(X(s.x), Y(790), 0, X(s.x), Y(790), 70 * k);
        fg.addColorStop(0, `rgba(${s.rgb},${(0.05 + 0.08 * b).toFixed(3)})`);
        fg.addColorStop(1, `rgba(${s.rgb},0)`);
        ctx.fillStyle = fg;
        ctx.fillRect(X(s.x - 70), Y(720), 140 * k, 140 * k);
      }
      // amber console lamps: a slow, slightly irregular task-light flicker
      for (const [i, l] of LAMPS.entries()) {
        const b = 0.5 + 0.5 * Math.sin(t * 1.3 + i * 2.1) * Math.sin(t * 0.37 + i);
        const g = ctx.createRadialGradient(X(l.x), Y(l.y), 0, X(l.x), Y(l.y), 46 * k);
        g.addColorStop(0, `rgba(242,180,65,${(0.1 + 0.14 * b).toFixed(3)})`);
        g.addColorStop(1, "rgba(242,180,65,0)");
        ctx.fillStyle = g;
        ctx.fillRect(X(l.x - 46), Y(l.y - 46), 92 * k, 92 * k);
      }
      // dust motes
      ctx.fillStyle = "#F3F5F7";
      for (const m of motes) {
        const mx = (((m.x + m.vx * t) % 1600) + 1600) % 1600;
        const my = 120 + ((((m.y - 120 + m.vy * t) % 700) + 700) % 700);
        ctx.globalAlpha = m.a * (0.55 + 0.45 * Math.sin(t * 0.9 + m.ph));
        ctx.beginPath();
        ctx.arc(X(mx), Y(my), Math.max(0.6, m.r * k), 0, 6.283);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
    };
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (now - last < 30) return; // ~30 fps is plenty for slow light
      last = now;
      draw(now);
    };
    if (still) draw(0);
    else raf = requestAnimationFrame(loop);
    const onResize = () => {
      resize();
      if (still) draw(0);
    };
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      c.width = 0;
      c.height = 0;
    };
  }, [still]);
  return <canvas ref={ref} className="menu__ambience" aria-hidden="true" tabIndex={-1} />;
}

async function quit(): Promise<void> {
  try {
    const mod = await import("@tauri-apps/api/window");
    await mod.getCurrentWindow().close();
  } catch (e) {
    console.warn("[menu] quit failed", e);
  }
}

/** Main menu — the owner's mockup (§10): plate, centred wordmark, centred text menu, ENTER / ESC hint. */
export function MenuScreen() {
  const journal = useApp((s) => s.journal);
  const set = useApp((s) => s.set);
  const hasSave = journal.length > 0;
  const [value, setValue] = useState("new");
  const items = [
    { id: "new", label: "New Expedition" },
    { id: "continue", label: "Continue", disabled: !hasSave },
    { id: "settings", label: "Settings" },
    { id: "credits", label: "Credits" },
    ...(env.isTauri ? [{ id: "quit", label: "Quit" }] : []),
  ];
  const onSelect = (id: string) => {
    if (id === "new" || id === "continue") void navigate("hub");
    else if (id === "settings") set({ overlay: "settings", overlayReturn: null });
    else if (id === "credits") set({ overlay: "credits", overlayReturn: null });
    else if (id === "quit") void quit();
  };
  const still = useReducedMotion();
  const root = useRef<HTMLElement>(null);
  // Keyboard modality (focus ring only for real keyboard use) + a faint pointer parallax on the plate.
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    let raf = 0;
    let tx = 0;
    let ty = 0;
    let cx = 0;
    let cy = 0;
    const tick = () => {
      cx += (tx - cx) * 0.08;
      cy += (ty - cy) * 0.08;
      el.style.setProperty("--px", cx.toFixed(4));
      el.style.setProperty("--py", cy.toFixed(4));
      raf = Math.abs(tx - cx) + Math.abs(ty - cy) > 0.002 ? requestAnimationFrame(tick) : 0;
    };
    const onKey = (e: KeyboardEvent) => {
      if (!e.metaKey && !e.ctrlKey && !e.altKey) el.setAttribute("data-kbd", "");
    };
    const onPointer = (e: PointerEvent) => {
      el.removeAttribute("data-kbd");
      if (still) return;
      tx = (e.clientX / window.innerWidth) * 2 - 1;
      ty = (e.clientY / window.innerHeight) * 2 - 1;
      if (!raf) raf = requestAnimationFrame(tick);
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("pointermove", onPointer);
    window.addEventListener("pointerdown", onPointer);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("pointermove", onPointer);
      window.removeEventListener("pointerdown", onPointer);
    };
  }, [still]);
  return (
    <main ref={root} className={`menu${still ? " is-still" : ""}`} aria-labelledby="menu-title" data-testid="menu">
      <Plate />
      <MenuAmbience still={still} />
      <div className="menu__scrim" aria-hidden="true" />
      <div className="menu__wordmark">
        <h1 id="menu-title" className="menu__h1">
          <Logo size={128} />
          <span className="br-visually-hidden">BlindRev — Follow the changes. Find the evidence.</span>
        </h1>
      </div>
      <nav className="menu__nav" aria-label="Main menu">
        <MenuList items={items} value={value} onChange={setValue} onSelect={onSelect} autoFocus />
        {!hasSave && <p className="br-visually-hidden">Continue is unavailable: no saved expedition yet.</p>}
      </nav>
      <div className="menu__hint">
        <KeyHint
          hints={[
            { key: "Enter", action: "Select" },
            { key: "Esc", action: "Back" },
          ]}
        />
      </div>
      <p className="menu__credit">
        Follow the changes. Find the evidence. · NASA Space Apps — SAR challenge · fictional bureau
      </p>
    </main>
  );
}
