/* Owner mockups (ARCHITECTURE §10): wordmark, loading/transit screen (the wipe's hold state) and the
 * hub → case "data tunnel" (Canvas2D only — never a second WebGL context). */
import { useEffect, useRef } from "react";
import { assetUrl } from "../env";
import { getMission } from "../mission/controller";
import "./ux-strike-1.css";

export function Wordmark({ size = 96, as: Tag = "h1", id }: { size?: number; as?: "h1" | "div"; id?: string }) {
  return (
    <Tag className="wordmark" style={{ fontSize: size }} id={id} aria-label="BlindRev">
      <span aria-hidden="true">
        Blind<span className="wordmark__r">R</span>ev
      </span>
    </Tag>
  );
}

export function Plate() {
  return (
    <div
      className="plate"
      style={{ backgroundImage: `url("${assetUrl("art/outpost-plate.jpg")}")` }}
      aria-hidden="true"
    />
  );
}

/** Thin outlined hexagon; one cyan segment travels round it (static under reduced motion). */
export function HexSpinner({ size = 64, still = false }: { size?: number; still?: boolean }) {
  const r = 26;
  const pts: string[] = [];
  for (let i = 0; i < 6; i++) {
    const a = ((60 * i - 90) * Math.PI) / 180;
    pts.push(`${(32 + r * Math.cos(a)).toFixed(2)},${(32 + r * Math.sin(a)).toFixed(2)}`);
  }
  const d = `M${pts.join(" L")} Z`;
  const per = 6 * r; // hexagon perimeter = 6 × side (side = r)
  return (
    <svg
      className={`hexspin${still ? " is-still" : ""}`}
      width={size}
      height={size}
      viewBox="0 0 64 64"
      aria-hidden="true"
    >
      <path d={d} fill="none" stroke="rgba(243,245,247,0.55)" strokeWidth={1.5} strokeLinejoin="round" />
      <path
        className="hexspin__seg"
        d={d}
        fill="none"
        stroke="#3DE0D0"
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeDasharray={`${per / 6} ${per}`}
        style={{ ["--per" as string]: `${per}` }}
      />
    </svg>
  );
}

export function LoadingScreen({
  progress,
  label,
  still,
  slow,
}: {
  progress: number | null;
  label: string;
  still: boolean;
  slow: boolean;
}) {
  const pct = progress === null ? null : Math.round(Math.min(1, Math.max(0, progress)) * 100);
  return (
    <div className="loading" role="status" aria-live="polite" data-testid="loading-screen">
      <Plate />
      <div className="loading__col">
        <Wordmark size={84} as="div" />
        <HexSpinner still={still} />
        <p className="loading__label">{label}</p>
        {slow && <p className="loading__slow">Still fetching imagery. Hang on.</p>}
      </div>
      <div className="loading__bar">
        <div
          className="loading__track"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct ?? undefined}
          aria-label="Loading progress"
        >
          <span
            className={`loading__fill${pct === null ? " is-indeterminate" : ""}`}
            style={pct === null ? undefined : { width: `${pct}%` }}
          />
        </div>
        <span className="loading__pct">{pct === null ? "…" : `${pct}%`}</span>
      </div>
      <p className="loading__tagline">Look closer. Every change tells a story.</p>
    </div>
  );
}

const ACCENTS = ["#3DE0D0", "#F2B441", "#E0489B", "#6C5CE7"];
/* Light strips along the six tunnel edges — the pillars' cyan + magenta, amber and indigo as accents. */
const EDGE_COL = ["61,224,208", "224,72,155", "108,92,231", "61,224,208", "224,72,155", "242,180,65"];
/* The AOI mosaic the journey assembles on arrival: the 3×3 optical context tiles (z9, {row}/{col}) around the case. */
const MOSAIC = {
  base: "mission-data/sinking-city/context/hls-s30/2026-06-29/9",
  rows: [199, 200, 201],
  cols: [84, 85, 86],
};
const smooth = (x: number) => {
  const c = Math.min(1, Math.max(0, x));
  return c * c * (3 - 2 * c);
};

/** The journey into a case: radar-wave rings, accent streaks and drifting fragments of the mission imagery.
 *  Pure Canvas2D, seeded (deterministic), runs until `onDone` is called by the parent; any key / click skips. */
export function DataTunnel({ onSkip }: { onSkip: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const resize = () => {
      c.width = Math.round(c.clientWidth * dpr);
      c.height = Math.round(c.clientHeight * dpr);
    };
    resize();
    // Imagery: the nine optical context tiles that lock into the AOI mosaic on arrival, plus loose
    // fragments of the evidence rasters that fly past on the way in.
    const load = (u: string) => {
      const im = new Image();
      im.src = assetUrl(u);
      return im;
    };
    const ok = (im: HTMLImageElement | undefined): im is HTMLImageElement => !!im && im.complete && im.naturalWidth > 0;
    const tiles: HTMLImageElement[] = [];
    for (const row of MOSAIC.rows) for (const col of MOSAIC.cols) tiles.push(load(`${MOSAIC.base}/${row}/${col}.png`));
    const imgs: HTMLImageElement[] = [];
    try {
      const m = getMission();
      const urls = m.steps
        .filter((s) => s.isAvailable && s.tileUrlTemplate && !/\{/.test(s.tileUrlTemplate))
        .map((s) => s.tileUrlTemplate);
      for (const u of urls.slice(0, 6)) imgs.push(load(u));
    } catch {
      /* no mission data: tunnel + mosaic only */
    }
    let seed = 0x9e3779b9;
    const rnd = () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = seed;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const RINGS = 18;
    const DZ = 0.55;
    const DEPTH = RINGS * DZ;
    const ZNEAR = 0.26;
    const SX = 1.22; // the tunnel is a little wider than tall, like the outpost's viewport frame
    const FACE_LIGHT = [0.5, 0.2, 0.34, 0.62, 0.95, 0.7];
    const streaks = Array.from({ length: 170 }, () => ({
      a: rnd() * 6.283,
      r: 0.28 + rnd() * 0.7,
      z: rnd() * DEPTH,
      v: 1 + rnd() * 0.7,
      col: ACCENTS[Math.floor(rnd() * 4)] ?? "#3DE0D0",
      w: 0.8 + rnd() * 1.4,
      len: 0.5 + rnd(),
    }));
    const mos = tiles.map((_, i) => ({
      a: rnd() * 6.283,
      r: 0.42 + rnd() * 0.4,
      z: 1.4 + rnd() * (DEPTH - 3),
      rot: (rnd() - 0.5) * 1.4,
      i,
    }));
    const frags = Array.from({ length: 10 }, (_, i) => ({
      a: rnd() * 6.283,
      r: 0.5 + rnd() * 0.38,
      z: rnd() * DEPTH,
      rot: (rnd() - 0.5) * 0.9,
      img: i % Math.max(1, imgs.length),
      sx: rnd(),
      sy: rnd(),
    }));
    const t0 = performance.now();
    let last = t0;
    let travel = 0;
    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      const t = (now - t0) / 1000;
      const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
      last = now;
      // Speed: build-up (0–0.38 s) → cruise → release (0.78–1.18 s) while the imagery locks into place.
      const up = smooth(t / 0.38);
      const rel = smooth((t - 0.78) / 0.4);
      const asm = smooth((t - 0.72) / 0.44);
      const speed = (0.5 + 5.4 * up * up) * (1 - 0.94 * rel);
      travel += speed * dt;
      const w = c.width;
      const h = c.height;
      const cx = w / 2;
      const cy = h / 2;
      const R = Math.hypot(cx, cy);
      const F = R * (0.34 + 0.12 * up * (1 - rel)); // field of view punches out at speed, settles on arrival
      const fade = Math.min(1, t / 0.18);
      const fog = (z: number) => Math.max(0, 1 - z / DEPTH) ** 1.25;
      const tw = (z: number) => Math.PI / 6 + z * 0.07 * up + t * 0.04;
      const px = (a: number, r: number, z: number) => cx + (Math.cos(a) * r * F * SX) / z;
      const py = (a: number, r: number, z: number) => cy + (Math.sin(a) * r * F) / z;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = "#0E1020";
      ctx.fillRect(0, 0, w, h);
      // depth: an indigo dusk at the vanishing point
      const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 0.62);
      glow.addColorStop(0, `rgba(108,92,231,${(0.5 * fade).toFixed(3)})`);
      glow.addColorStop(0.3, `rgba(70,84,200,${(0.2 * fade).toFixed(3)})`);
      glow.addColorStop(1, "rgba(14,16,32,0)");
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, w, h);
      // faceted tunnel walls, far → near (solid panels give the depth; ribs + edge strips give the speed)
      const off = travel % DZ;
      const id0 = Math.floor(travel / DZ);
      ctx.lineJoin = "round";
      for (let j = RINGS - 1; j >= 0; j--) {
        const zn = Math.max(ZNEAR, ZNEAR + j * DZ + DZ - off - DZ);
        const zf = ZNEAR + (j + 1) * DZ - off;
        const id = j + id0;
        const an = tw(zn);
        const af = tw(zf);
        const fg = fog(zn) * fade;
        if (fg <= 0.003) continue;
        for (let f = 0; f < 6; f++) {
          const a0 = (Math.PI / 3) * f;
          const a1 = a0 + Math.PI / 3;
          const L = (FACE_LIGHT[f] ?? 0.4) * ((id + f) % 2 ? 1 : 0.78);
          ctx.fillStyle = `rgba(${Math.round(14 + 34 * L)},${Math.round(16 + 38 * L)},${Math.round(32 + 62 * L)},${(0.94 * fg).toFixed(3)})`;
          ctx.beginPath();
          ctx.moveTo(px(a0 + af, 1, zf), py(a0 + af, 1, zf));
          ctx.lineTo(px(a1 + af, 1, zf), py(a1 + af, 1, zf));
          ctx.lineTo(px(a1 + an, 1, zn), py(a1 + an, 1, zn));
          ctx.lineTo(px(a0 + an, 1, zn), py(a0 + an, 1, zn));
          ctx.closePath();
          ctx.fill();
        }
        // rib at the far ring of this segment (every third rib is a brighter frame)
        const rib = (id + 1) % 3 === 0;
        const fgf = fog(zf) * fade;
        ctx.strokeStyle = `rgba(61,224,208,${((rib ? 0.75 : 0.22) * fgf).toFixed(3)})`;
        ctx.lineWidth = Math.min(5, Math.max(0.6, (rib ? 1.6 : 0.9) / zf)) * dpr;
        ctx.beginPath();
        for (let f = 0; f <= 6; f++) {
          const a = (Math.PI / 3) * f + af;
          if (f === 0) ctx.moveTo(px(a, 1, zf), py(a, 1, zf));
          else ctx.lineTo(px(a, 1, zf), py(a, 1, zf));
        }
        ctx.stroke();
        // dashed light strips along the six edges
        ctx.globalCompositeOperation = "lighter";
        ctx.lineWidth = Math.min(7, Math.max(0.7, 2 / zn)) * dpr;
        for (let f = 0; f < 6; f++) {
          if ((id + f) % 2) continue;
          const a0 = (Math.PI / 3) * f;
          ctx.strokeStyle = `rgba(${EDGE_COL[f]},${(0.85 * fg).toFixed(3)})`;
          ctx.beginPath();
          ctx.moveTo(px(a0 + af, 0.985, zf), py(a0 + af, 0.985, zf));
          ctx.lineTo(px(a0 + an, 0.985, zn), py(a0 + an, 0.985, zn));
          ctx.stroke();
        }
        ctx.globalCompositeOperation = "source-over";
      }
      // radar-wave fronts washing out from the observation point
      ctx.globalCompositeOperation = "lighter";
      for (let k = 0; k < 5; k++) {
        const p = (t * 0.85 + k / 5) % 1;
        const rr = p ** 1.8 * R * 1.05;
        const a = (1 - p) * 0.5 * fade * (1 - 0.7 * asm);
        ctx.strokeStyle = `rgba(61,224,208,${a.toFixed(3)})`;
        ctx.lineWidth = (1 + 4 * p) * dpr;
        ctx.beginPath();
        ctx.ellipse(cx, cy, rr * SX, rr, 0, 0, 6.2832);
        ctx.stroke();
        ctx.strokeStyle = `rgba(61,224,208,${(a * 0.35).toFixed(3)})`;
        ctx.lineWidth = dpr;
        ctx.beginPath();
        ctx.ellipse(cx, cy, rr * SX * 0.93, rr * 0.93, 0, 0, 6.2832);
        ctx.stroke();
      }
      // streaks in the four fringe accents — their length is the speed
      ctx.lineCap = "round";
      for (const s of streaks) {
        s.z -= speed * s.v * dt;
        if (s.z < 0.14) s.z += DEPTH;
        const z2 = s.z + (0.03 + speed * 0.05) * s.len;
        ctx.strokeStyle = s.col;
        ctx.globalAlpha = Math.min(1, fog(s.z) * 1.7) * fade * (1 - 0.45 * asm);
        ctx.lineWidth = s.w * dpr * Math.min(3, Math.max(0.5, 0.7 / s.z));
        ctx.beginPath();
        ctx.moveTo(px(s.a, s.r, z2), py(s.a, s.r, z2));
        ctx.lineTo(px(s.a, s.r, s.z), py(s.a, s.r, s.z));
        ctx.stroke();
      }
      ctx.lineCap = "butt";
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
      // loose evidence fragments fly past and thin out as the mosaic takes over
      for (const f of frags) {
        f.z -= speed * 0.8 * dt;
        if (f.z < 0.4) f.z += DEPTH;
        const im = imgs[f.img];
        if (!ok(im)) continue;
        const s = (0.34 * F) / f.z;
        const a = Math.min(1, fog(f.z) * 1.5) * fade * (1 - asm) * 0.9;
        const fpx = px(f.a, f.r, f.z);
        const fpy = py(f.a, f.r, f.z);
        // keep the caption ("Entering the data…") clear of flying cards
        if (a <= 0.01 || (fpy > h * 0.74 && Math.abs(fpx - cx) < w * 0.24)) continue;
        ctx.save();
        ctx.globalAlpha = a;
        ctx.translate(fpx, fpy);
        ctx.rotate(f.rot + f.z * 0.05);
        const sw = im.naturalWidth * 0.3;
        const sh = im.naturalHeight * 0.3;
        const dh = s * (sh / sw);
        ctx.fillStyle = "rgba(28,32,54,0.72)"; // evidence rasters are mostly transparent: give them a card
        ctx.fillRect(-s / 2, -dh / 2, s, dh);
        ctx.drawImage(
          im,
          f.sx * (im.naturalWidth - sw),
          f.sy * (im.naturalHeight - sh),
          sw,
          sh,
          -s / 2,
          -dh / 2,
          s,
          dh,
        );
        ctx.strokeStyle = "rgba(243,245,247,0.5)";
        ctx.lineWidth = dpr;
        ctx.strokeRect(-s / 2, -dh / 2, s, dh);
        ctx.restore();
      }
      // the AOI mosaic: nine real tiles fly in the stream, then lock into their true positions
      const cell = Math.round(Math.min(w, h) * 0.15);
      const mx0 = cx - cell * 1.5;
      const my0 = cy - cell * 1.5 - h * 0.02;
      if (asm > 0) {
        ctx.fillStyle = `rgba(14,16,32,${(0.7 * asm).toFixed(3)})`;
        ctx.fillRect(mx0 - 6 * dpr, my0 - 6 * dpr, cell * 3 + 12 * dpr, cell * 3 + 12 * dpr);
      }
      for (const m of mos) {
        if (asm === 0) {
          m.z -= speed * 0.7 * dt;
          if (m.z < 0.7) m.z += DEPTH - 1;
        }
        const k = smooth(asm * 1.4 - m.i * 0.045);
        const fx = px(m.a, m.r, m.z);
        const fy = py(m.a, m.r, m.z);
        const fs = Math.min(cell * 2.2, (0.4 * F) / m.z);
        const tx = mx0 + ((m.i % 3) + 0.5) * cell;
        const ty = my0 + (Math.floor(m.i / 3) + 0.5) * cell;
        const s = fs + (cell - fs) * k;
        ctx.save();
        ctx.globalAlpha = (Math.min(1, fog(m.z) * 1.6) * (1 - k) + k) * fade;
        ctx.translate(fx + (tx - fx) * k, fy + (ty - fy) * k);
        ctx.rotate(m.rot * (1 - k));
        const im = tiles[m.i];
        if (ok(im)) ctx.drawImage(im, -s / 2, -s / 2, s + 0.5, s + 0.5);
        else {
          ctx.fillStyle = "#1C2036";
          ctx.fillRect(-s / 2, -s / 2, s, s);
        }
        if (k < 0.98) {
          ctx.strokeStyle = `rgba(243,245,247,${(0.55 * (1 - k)).toFixed(3)})`;
          ctx.lineWidth = dpr;
          ctx.strokeRect(-s / 2, -s / 2, s, s);
        }
        ctx.restore();
      }
      if (asm > 0.6) {
        // instrument brackets close around the assembled scene; one wave front releases outward
        const a = smooth((asm - 0.6) / 0.4);
        const pad = (10 + 14 * (1 - a)) * dpr;
        const x0 = mx0 - pad;
        const y0 = my0 - pad;
        const x1 = mx0 + cell * 3 + pad;
        const y1 = my0 + cell * 3 + pad;
        const arm = cell * 0.32;
        ctx.strokeStyle = `rgba(61,224,208,${a.toFixed(3)})`;
        ctx.lineWidth = 2 * dpr;
        ctx.beginPath();
        for (const [bx, by, dx, dy] of [
          [x0, y0, 1, 1],
          [x1, y0, -1, 1],
          [x1, y1, -1, -1],
          [x0, y1, 1, -1],
        ] as const) {
          ctx.moveTo(bx + dx * arm, by);
          ctx.lineTo(bx, by);
          ctx.lineTo(bx, by + dy * arm);
        }
        ctx.stroke();
        const p = (t - 1.1) / 0.55;
        if (p > 0 && p < 1) {
          ctx.globalCompositeOperation = "lighter";
          ctx.strokeStyle = `rgba(61,224,208,${(0.55 * (1 - p)).toFixed(3)})`;
          ctx.lineWidth = (2 + 6 * p) * dpr;
          const rr = cell * 2.2 + p * R * 0.55;
          ctx.beginPath();
          for (let i = 0; i <= 6; i++) {
            const an = (Math.PI / 3) * i + Math.PI / 6;
            if (i === 0) ctx.moveTo(cx + rr * SX * Math.cos(an), cy + rr * Math.sin(an));
            else ctx.lineTo(cx + rr * SX * Math.cos(an), cy + rr * Math.sin(an));
          }
          ctx.stroke();
          ctx.globalCompositeOperation = "source-over";
        }
      } else {
        // observation point
        ctx.fillStyle = `rgba(61,224,208,${(fade * (1 - asm)).toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(cx, cy, 3.5 * dpr, 0, 6.2832);
        ctx.fill();
      }
    };
    raf = requestAnimationFrame(draw);
    const skip = () => onSkip();
    window.addEventListener("keydown", skip);
    window.addEventListener("resize", resize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", skip);
      window.removeEventListener("resize", resize);
      c.width = 0;
      c.height = 0;
    };
  }, [onSkip]);
  return (
    <div className="tunnel" data-testid="data-tunnel" onPointerDown={onSkip}>
      <div className="tunnel__canvasWrap" aria-hidden="true">
        <canvas ref={ref} className="tunnel__canvas" />
      </div>
      <p className="tunnel__label" role="status">
        Entering the data… <span className="tunnel__skip">Press any key to skip</span>
      </p>
    </div>
  );
}
