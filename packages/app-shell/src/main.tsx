// Cesium resolves its Workers / Assets / Widgets relative to this; must be set before the globe chunk loads.
window.CESIUM_BASE_URL = new URL("cesium/", document.baseURI).href;

import "@blindrev/ui-hud/styles.css";
import "./app.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { loadMission, loadPrefabs, loadTleSnapshot, loadWarnings } from "./data/loaders";
import { env } from "./env";
import { installHarness } from "./harness/harness";
import { installMissionController } from "./mission/controller";
import { refreshTle, startNisarTicker } from "./mission/nisar";
import { installSound } from "./mission/soundBridge";
import { navigate } from "./scene/navigation";
import { useApp } from "./store";

function bootFailure(e: unknown): void {
  const root = document.getElementById("root");
  if (!root) return;
  const msg = e instanceof Error ? e.message : String(e);
  root.innerHTML = "";
  const box = document.createElement("main");
  box.className = "boot-fail";
  box.innerHTML = `<h1>BlindRev could not start</h1><p>The bundled case data did not pass validation.</p><pre></pre>`;
  const pre = box.querySelector("pre");
  if (pre) pre.textContent = msg;
  root.appendChild(box);
  console.error("[boot]", e);
}

try {
  // Validate every bundled data file up front (Zod) — fail loudly, never run on bad data.
  loadPrefabs();
  loadTleSnapshot();
  loadMission();
  for (const w of loadWarnings) console.warn("[boot]", w);

  installMissionController();
  installHarness();
  installSound();
  startNisarTicker();
  void refreshTle();

  const el = document.getElementById("root");
  if (!el) throw new Error("#root missing");
  createRoot(el).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );

  if (env.initialRoute && env.initialRoute !== "menu") {
    const target = env.initialRoute;
    requestAnimationFrame(() => {
      void navigate(target).then(() => {
        if (target === "mission" && new URLSearchParams(location.search).get("briefing") === "1")
          useApp.setState({ overlay: "briefing" });
      });
    });
  }
} catch (e) {
  bootFailure(e);
}
