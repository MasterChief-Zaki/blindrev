/** Outpost Signal palette (ARCHITECTURE §8) — locked HEX values — and the globe's injected CSS. */

export const PALETTE = {
  ink: "#0E1020",
  graphite: "#1C2036",
  pearl: "#F3F5F7",
  cyan: "#3DE0D0",
  amber: "#F2B441",
  magenta: "#E0489B",
  indigo: "#6C5CE7",
} as const;

const STYLE_ID = "br-globe-style";

/**
 * Minimal CSS for the Cesium widget (we do not depend on widgets.css) plus a small, scrimmed,
 * always-visible credit strip. Attributions are mandatory, so the strip is never hidden.
 */
export const GLOBE_CSS = `
.br-globe-root{position:absolute;inset:0;overflow:hidden;background:${PALETTE.ink};}
.br-globe-root .cesium-widget{position:absolute;inset:0;width:100%;height:100%;overflow:hidden;}
.br-globe-root .cesium-widget canvas{display:block;width:100%;height:100%;touch-action:none;outline:none;}
.br-globe-root .cesium-widget canvas:focus-visible{outline:2px solid ${PALETTE.cyan};outline-offset:-2px;}
.br-globe-root.br-draw .cesium-widget canvas{cursor:crosshair;}
.br-globe-root.br-drag .cesium-widget canvas{cursor:grabbing;}
.br-globe-credits{position:absolute;left:8px;bottom:8px;max-width:min(70%,760px);z-index:2;
  padding:3px 8px;border-radius:8px;background:rgba(14,16,32,0.78);color:${PALETTE.pearl};
  font:400 11px/1.45 "IBM Plex Sans",system-ui,sans-serif;pointer-events:auto;}
.br-globe-credits a{color:${PALETTE.pearl};text-decoration:underline;}
.br-globe-credits .cesium-credit-logoContainer{display:inline-block;vertical-align:middle;margin-right:6px;}
.br-globe-credits .cesium-credit-logoContainer img{height:16px;vertical-align:middle;}
.br-globe-credits .cesium-credit-textContainer{display:inline;}
.br-globe-credits .cesium-credit-expand-link{color:${PALETTE.cyan};cursor:pointer;margin-left:6px;}
.br-globe-credits .cesium-credit-expand-link:focus-visible{outline:2px solid ${PALETTE.cyan};outline-offset:2px;}
`;

export function ensureGlobeStyles(doc: Document): void {
  if (doc.getElementById(STYLE_ID)) return;
  const el = doc.createElement("style");
  el.id = STYLE_ID;
  el.textContent = GLOBE_CSS;
  doc.head.appendChild(el);
}
