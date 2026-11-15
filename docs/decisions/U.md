# Agent U — ui-hud decisions

## Type scale (rem; 1rem = 16 px)

- The PDF's desktop column is TV-scale (88/64/48 px for a 1920 board), so the HUD scale is derived from the **mobile column** with small trims:
  Display 3rem/800/1.04/−0.02em · H1 2.25rem/800/1.10 · H2 1.75rem/600/1.15 · H3 1.375rem/600 · H4 1.125rem/600 (panel heading) ·
  Body L 1.125rem · Body 1rem (16 px) · Body S 0.9375rem · Caption 0.875rem · Label 0.8125rem Plex Sans 600 caps +0.04em · Mono 0.875rem / Mono-S 0.8125rem.
- Labels use **Plex Sans 600 caps**, not "mono 600", because Plex Mono ships only at 400. Telemetry (dates, coordinates, codes) is Plex Mono 400.
- All type is in rem. Layouts use wrap, `minmax(0, …)` and container queries, so 200 % text size reflows without clipping. Checked in the gallery with `--eval "document.documentElement.style.fontSize='200%'"`: the timeline scrolls horizontally inside its own scroller, and the ROI side panel stacks under the map.

## Visual decisions

- 0 % glow everywhere: no text-shadow or box-shadow glows. Elevation is Ink → Graphite → Active (#272C47, derived). The only box-shadows are inset 1 px hairlines and the 3 px active-tool bar.
- Chamfered panels use `clip-path`. Their two diagonal border segments are drawn as gradient pseudo-elements, and they carry a small amber "task-light" tab. The modal is chamfered too: per the guide's "Mission modal" it is a mission panel.
- Derived colours, contrast measured: text-muted #B4BACB 8.3:1 on Graphite; text-faint #8D94AB 5.3:1; indigo icon tint #A69DF2 7.8:1 on Ink (raw indigo #6C5CE7 is 3.9:1, so indigo is used only for borders and never as a text background); progress track #3B4262 (cyan reads 6.0:1 on it).
- Badges sit on an Ink chip, so magenta/indigo borders never put coloured text on Graphite. STALE_EPHEMERIS and ALERT are amber fill with Ink text (10.2:1). The visible word is the exact honesty code (`STALE_EPHEMERIS`); screen readers hear "Alert: stale ephemeris".
- `Button disabled` = native disabled (not focusable). `locked` = `aria-disabled`, still focusable, with a lock icon and hatching.
- Biome's formatter lowercases HEX. I restored the locked values to uppercase in `EARTH_exe_Outpost_Tokens.css`. A future `biome format` may lowercase them again, which is harmless because HEX is case-insensitive.
- §10 addendum: the wordmark is Outfit 800 Pearl. The R's stem foot is cut out with a CSS `mask` (`mask-composite: exclude`, so any backdrop shows through) and replaced by a cyan parallelogram. The offsets (em) were tuned against `mainmenu.jpeg` by side-by-side crops. `Logo` defaults to `variant="wordmark"`; the hex ring stays as `variant="ring"`/`"lockup"`.
- The WipeOverlay hold state _is_ the §10 loading screen (wordmark, hex spinner, label, thin bar + mono %, tagline, optional plate under a radial Ink scrim).

## Sound — analysis of the three supplied clips (ffprobe, volumedetect/ebur128, spectrogram + waveform PNGs, autocorrelation)

| Supplied file                                                | Duration | Loudness                             | What it is                                                                                                                                            | Used as                                                                                                                                                                                                                         |
| ------------------------------------------------------------ | -------- | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `…9.27.17 PM.mpeg` → `originals/clip-a-pulse-buzz.mp3`       | 1.65 s   | −8.3 LUFS, peaks at 0 dBFS (clipped) | broadband amplitude-pulsed buzz (~50 Hz pulse train), 0.6 s body then decay to 1.36 s; mechanical rattle/shutter character                            | **travel** (`travel-shutter.mp3`: −12 dB → −20.7 LUFS, 9 kHz low-pass, trimmed 1.4 s). Its 0.6 s body matches the 500 ms wipe. Also **press** (`ui-press.mp3`: 57 ms slice, 3.5 kHz low-pass, exponential decay = a warm click) |
| `…9.27.18 PM (1).mpeg` → `originals/clip-b-rising-chime.mp3` | 1.78 s   | −19.3 LUFS                           | soft harmonic arpeggio on a 110 Hz series (≈220→330→440→660 Hz), last note rings ~0.8 s                                                               | **confirm** (`ui-confirm.mp3`: trimmed 1.15 s, −1 dB → −19.9 LUFS)                                                                                                                                                              |
| `…9.27.18 PM.mpeg` → `originals/clip-c-ping-beacon.mp3`      | 11.15 s  | −37.2 LUFS (very quiet)              | 5 soft G4 (~394 Hz) pings with harmonics, each ringing ~1.2 s, every 1.85 s; 1.1 s of silence at the start and 1.5 s at the end. Not a continuous bed | **scan** (`scan-ping.mp3`: one ping, +16 dB → −25.7 LUFS) and the **ambient** beacon layer (`ambient-beacon-loop.mp3`: 1.00–10.24 s = exactly 5 periods, so it loops seamlessly, +8 dB → −29.8 LUFS)                            |
- The brief said "the long one → ambient bed **or** scan, whichever its analysis supports". It is a repeating ping, so it maps naturally to **scan**. As an ambient it is used only as a quiet layer (gain 0.35) over a synthesised 55/110.4 Hz low hum with a slow filter LFO. That keeps the brand's "low hum" without a ping every 1.85 s dominating.
- **alert** is synthesised: a soft descending triangle two-tone 659 → 440 Hz. None of the clips fits, and a buzzer reads as threatening, which goes against the brand's "curious and capable, never threatening".
- Clip A is a buzz, not a click, so mapping it whole to `press` would be 1.6 s of harsh noise on every button. A 57 ms slice of it gives the "warm click" instead.
- Originals are kept byte-identical in `app-shell/public/audio/originals/` (not loaded at runtime). Both folders have an `ASSET_LICENSE.json` ("supplied by the project owner"). Files are MP3 160 kbps / 44.1 kHz, which WebView2 decodes natively.
- Engine: WebAudio. It unlocks lazily on the first pointerdown/keydown/touchstart and fetches/decodes buffers only after unlock. Per-role gain trims and minimum gaps stop machine-gun repeats. Every call is a no-op when disabled, unsupported or not yet unlocked, and any missing or failed file falls back to a synthesised beep.

## Deviations / additions vs ARCHITECTURE §6 (all additive; no §6 name or prop changed)

- `Logo` gains `variant` and **defaults to the wordmark** (§10 override). `withWordmark` still works (true → lockup, false → ring).
- `IconName` is a superset: `info plus trash undo move flag sound mute chevronLeft chevronRight`.
- Optional extras: `Button.sound`; `Panel.className/id/data-testid`; `Modal.kicker/data-testid`; `Slider.format/data-testid`; `Toggle.disabled/data-testid`; `Tabs.label/idPrefix`; `ProgressBar.variant`; `WipeOverlay.backgroundUrl/tagline/showWordmark`.
- New exports: `HexSpinner`, `MenuList`, `KeyHint`, `ToolRail`, `ToolButton`, `getAnnouncements`, `ANNOUNCE_DEDUPE_MS`, `daysApart`, `timelineValueText`, mapping helpers, `getSoundStatus`, `SOUND_FILES`.
- Timeline columns are spaced by index, not by date: discrete acquisitions, no implied interpolation.
- Timeline keys A/B (mark the current step) and ROI key `C` (close) are extra shortcuts.
- The ROI keyboard cursor moves by 1/50 of the span (Shift ×5) when no vertex is selected. Only the _selected-vertex_ nudge uses `nudgeDeg`/`coarseFactor`, via core-sim `nudgeVertex`, because 0.001° steps are unusable for crossing a 0.4° AOI.
- The ROI points table testid is `roi-points-table` (not `roi-vertex-table`) so `[data-testid^="roi-vertex-"]` counts vertices only.
- Clear asks for confirmation inline (`roi-clear` → `roi-clear-confirm`), not through a Modal, so it works inside an overlay.
- The gallery's Vite config serves `app-shell/public` as its public dir (read-only use) so the real sounds play. A gallery-only copy of the background plate lives in `ui-hud/gallery/assets/` with an ASSET_LICENSE.

## Verification

- `tsc --noEmit -p .` clean (src + gallery). `vitest run`: 13 tests pass (mapping round-trip < 1e-9°, corners, linearity, cos(lat) aspect, determinism, graticule, formatting). `biome lint packages/ui-hud`: 0 errors (warnings only: `!important` in the reduced-motion and visually-hidden rules, CSS specificity order, and index keys for positional vertices).
- Gallery screenshots reviewed in 4 look-and-fix rounds at 1440×900 and 1280×720 (full page, modal open, reduced motion, 200 % text). Fixes from those rounds: hex-spinner segment invisible while animating (calc() in keyframes → fixed `-156px`); wordmark notch (3 rounds of crops against the mockup); menu mock layout; ROI readout moved off the map; axis-label thinning and edge anchoring; ROI side panel stacking via container query; ROI canvas column sized to its cap.
- Keyboard run through synthetic key events in headless Chromium: clear → 3 points by Enter/arrows → `C` closes (validation then correctly reports AREA_TOO_SMALL at 10 km²), `]` + → nudges lon by exactly 0.001°, Ctrl+Z undoes, timeline ←/→/End give the right `aria-valuetext`, stepping onto an unavailable step gives PAUSED_UNAVAILABLE and an assertive "No acquisition" announcement, pair Δt is 84 days with no warning.

## Unfinished / notes for others

- No component tests in jsdom; only the pure mapping helpers are unit-tested. The widgets were exercised in the browser through the gallery. E2E (phase 2) should use the testids in the README.
- Modal focus trap + inert: verified visually and by code path, not by an automated test.
- Wordmark notch offsets are tuned for Outfit 800 at display sizes. Below ~24 px use `variant="ring"`.
- F must ship the plate at `app-shell/public/art/outpost-plate.jpg` (not U's folder) and pass it as `backgroundUrl`.

STATUS: DONE
