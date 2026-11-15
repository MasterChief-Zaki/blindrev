# Manual accessibility checklist (SPEC §14, §15 — WCAG 2.2 AA)

Some §15 criteria are covered by gating Playwright tests (keyboard-only ROI editing, reduced motion, live-region assertions). This checklist covers what automation cannot judge, and repeats the gated items once by hand in the **packaged app**. Fill the result column with `PASS`, `FAIL (what happened)` or `NOT MEASURED (reason)`. Every result starts as NOT MEASURED.

## Setup

| Item                         | Value to record                                                                                                                                                                                |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Build                        | Packaged exe (`pnpm desktop:build` → `packages\app-shell\src-tauri\target\release\blindrev.exe`) or the debug shell from `docs/checklists/manual-gpu.md` (needed for the devtools steps below) |
| Windows version              |                                                                                                                                                                                                |
| Screen reader + version      | NVDA (free) or Windows Narrator                                                                                                                                                                |
| Display resolution / scaling |                                                                                                                                                                                                |
| Tester, date                 |                                                                                                                                                                                                |

Useful facts from the source:

- In-app settings (main menu or command board → **Settings**): Quality, **Reduced motion** (System / On / Off), Sound, Globe camera (custom ENU camera on/off).
- `?motion=reduced` forces reduced motion for one session (debug build: in the devtools console, `location.href = location.origin + "/?motion=reduced"`).
- The app has one shared `aria-live` host (`LiveRegion` in `@blindrev/ui-hud`).
- The mission screen always contains a screen-reader transcript (`SrSummary`, `data-testid="sr-summary"`) with a visible "Show mission transcript" toggle.

Key bindings (read from the source, not from memory):

| Where                                | Keys                                                                                                                                                                                                                                  |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Main menu                            | Up / Down or W / S move, Enter selects, Esc backs out of sub-panels                                                                                                                                                                   |
| Hub (command board)                  | Tab between cases and buttons, Enter to open                                                                                                                                                                                          |
| Data tunnel (hub → case)             | Any key skips                                                                                                                                                                                                                         |
| Globe camera (custom ENU controller) | W A S D pan, Z / X zoom in / out, Q / E rotate, R / F tilt, mouse wheel zoom, left-drag pan, right- or middle-drag (or Shift-drag) rotate / tilt. Suspended while a text field, slider or dialog has focus                            |
| Globe (mission map focused)          | With a corner selected: arrows nudge it 0.001° (Shift: × 10). `[` / `]` select the previous / next corner. While marking: Enter closes the region (≥ 3 corners), Backspace removes the last corner, Esc stops marking                 |
| Timeline                             | Left / Down step back, Right / Up step forward, Home / End first / last, Space play / pause, A / B mark the current date as baseline / comparison                                                                                     |
| 2D ROI editor                        | Arrows move the cursor (Shift: faster); Enter or Space adds a point; C closes the shape; `[` / `]` select points; arrows nudge the selected point by 0.001° (Shift × 10); Delete / Backspace removes it; Esc deselects; Ctrl+Z undoes |
| Dialogs                              | Esc closes; focus is trapped inside                                                                                                                                                                                                   |

## Checks

### 1. Text zoom 200 %

WCAG 1.4.4. Tauri v2's `zoomHotkeysEnabled` window option is not set in `tauri.conf.json`, and its default is off, so Ctrl + Plus is expected **not** to zoom the packaged app. Check it, then use the browser path.

| #   | Steps                                                                                                                                                                                                                                                                                 | Expected                                                                                                                 | Result       |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------ |
| 1.1 | Packaged app: press Ctrl + Plus four times.                                                                                                                                                                                                                                           | Record whether the page zooms. If it does not, note it as a finding for the shell (agent S).                             | NOT MEASURED |
| 1.2 | Packaged app: Windows Settings → Accessibility → Text size → 200 %, Apply; restart the app.                                                                                                                                                                                           | Record whether app text grows.                                                                                           | NOT MEASURED |
| 1.3 | Browser build: `pnpm build` then `pnpm preview` (port 4173), open `http://localhost:4173` in Microsoft Edge (same engine as WebView2), Ctrl + Plus to 200 %, window 1280 × 720 or larger. Walk menu → hub → mission → briefing → timeline → 2D editor → validate → results → journal. | All text readable; nothing clipped or overlapping; no horizontal scrolling inside panels; every control still reachable. | NOT MEASURED |
| 1.4 | Same as 1.3 at 200 %: open every overlay (Briefing, Journal, Settings, Credits, Results, 2D ROI editor).                                                                                                                                                                              | Overlays scroll internally; Close and primary buttons stay visible.                                                      | NOT MEASURED |

### 2. Reduced motion

| #   | Steps                                                                                                                                                       | Expected                                                                                                                              | Result       |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| 2.1 | Windows Settings → Accessibility → Visual effects → Animation effects **Off**. In the app, Settings → Reduced motion → **System**. Go menu → hub → mission. | Route changes are an immediate cut (no 500 ms wipe). The hub → case "data tunnel" animation is replaced by the static loading screen. | NOT MEASURED |
| 2.2 | Same setup. On the mission, press Play on the timeline.                                                                                                     | No auto-play sweep. It steps one acquisition and announces "Auto-play is off with reduced motion. Stepped forward one acquisition."   | NOT MEASURED |
| 2.3 | Same setup. Close the briefing with "Start investigation" (this calls `flyTo("aoi")`).                                                                      | Camera jumps to the AOI; no smooth flight; the watch does not start playing by itself.                                                | NOT MEASURED |
| 2.4 | Same setup. Hub.                                                                                                                                            | No bloom transitions or parallax; meaning (which case is selected) is still clear.                                                    | NOT MEASURED |
| 2.5 | Animation effects back **On**; in-app Reduced motion → **On**. Repeat 2.1–2.3.                                                                              | Same as above: the in-app switch overrides the OS.                                                                                    | NOT MEASURED |
| 2.6 | In-app Reduced motion → **Off** with OS animations off.                                                                                                     | Full motion. Record that the user override works.                                                                                     | NOT MEASURED |

### 3. Contrast over imagery

Target: text ≥ 4.5 : 1 (large text ≥ 3 : 1), non-text UI ≥ 3 : 1. HUD text over streamed tiles must always sit on a scrim. Tool: Colour Contrast Analyser (TPGi, free) eyedropper, or the devtools colour picker in a debug build.

| #   | Steps                                                                                                                                                                                                                                | Expected                                                                | Result       |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- | ------------ |
| 3.1 | Mission at the AOI view, context layer = MODIS true colour on the brightest date (pick the date with the most cloud / bright soil). Measure the HUD header (date, platform, badges), the legend, the timeline labels, the tool rail. | Every text sample ≥ 4.5 : 1 against the scrim behind it.                | NOT MEASURED |
| 3.2 | Same with the NISAR GCOV radar context layer and with the evidence layer at 100 % opacity.                                                                                                                                           | ≥ 4.5 : 1.                                                              | NOT MEASURED |
| 3.3 | Globe labels drawn on the map (AOI outline label, anomaly labels when the Anomaly Detector is on, ground-track label).                                                                                                               | ≥ 4.5 : 1, or the label has its own backing. Record the worst case.     | NOT MEASURED |
| 3.4 | Main menu and loading screen over the background plate.                                                                                                                                                                              | Menu items and footer hint ≥ 4.5 : 1.                                   | NOT MEASURED |
| 3.5 | Look for the two brand pairs to avoid: Pearl text on Indigo (4.45 : 1) and Magenta text on Graphite (4.25 : 1).                                                                                                                      | Neither pair is used for text.                                          | NOT MEASURED |
| 3.6 | Badges (`SIMULATED`, `OFFLINE`, `STALE_EPHEMERIS`, `TEST_FIXTURE`, `PLACEHOLDER`, info / alert).                                                                                                                                     | Each has an icon **and** a word; meaning never depends on colour alone. | NOT MEASURED |

### 4. Keyboard-only ROI editing (no mouse at all)

Unplug or ignore the mouse for the whole section.

| #   | Steps                                                                                                                        | Expected                                                                                                                    | Result       |
| --- | ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------ |
| 4.1 | From app start, reach the mission with Tab / arrows / Enter only.                                                            | Possible; focus always visible.                                                                                             | NOT MEASURED |
| 4.2 | Timeline: focus it, use Right / Left / Home / End, Space; press A on one date and B on a date ≥ 24 days later.               | Pair is set; the pair status says it is valid. On an unavailable date, A / B are refused and "No acquisition" is announced. | NOT MEASURED |
| 4.3 | Open the 2D editor (button "2D editor", `data-testid="open-2d-editor"`). Add 4 points with arrows + Enter, press C to close. | Region closes; area and validity are read out.                                                                              | NOT MEASURED |
| 4.4 | Select a point with `]`, nudge it with arrows, then Shift + arrows.                                                          | Moves 0.001° per press, 0.01° with Shift; each move is announced with the new coordinates.                                  | NOT MEASURED |
| 4.5 | Make the shape cross itself, then fix it with Ctrl + Z.                                                                      | Error message "The outline crosses itself…" appears and is announced; undo restores a valid shape.                          | NOT MEASURED |
| 4.6 | Close the editor (Esc or its button), focus the mission map, select a corner with `]` and nudge it with arrows.              | Same nudge behaviour on the globe path.                                                                                     | NOT MEASURED |
| 4.7 | Validate, read the verdict, save to the Case Journal, return to the hub.                                                     | All reachable by keyboard; focus lands somewhere sensible after each dialog closes.                                         | NOT MEASURED |
| 4.8 | While a Slider or a dialog has focus, press W / A / S / D.                                                                   | The globe camera does not move (focus arbitration).                                                                         | NOT MEASURED |

### 5. Focus ring

| #   | Steps                                                                      | Expected                                                                                                              | Result       |
| --- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------ |
| 5.1 | Tab through the menu, hub, mission HUD, timeline, 2D editor, every dialog. | Every focused control shows a 2 px Cyan `#3DE0D0` ring with a 5 px offset. The ring is never clipped by a panel edge. | NOT MEASURED |
| 5.2 | Same over bright imagery.                                                  | Ring still visible (≥ 3 : 1 against the adjacent colours).                                                            | NOT MEASURED |
| 5.3 | Open and close each dialog.                                                | Focus moves into the dialog on open, stays trapped, and returns to the opener on close.                               | NOT MEASURED |

### 6. Target size ≥ 44 × 44 px

Debug build: devtools → Elements → select the control → check the box model. Or use the inspect tooltip.

| #   | Steps                                                                                            | Expected                                                                | Result       |
| --- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- | ------------ |
| 6.1 | The 24 px chamfered **Return to command board** button (top left of the mission).                | Clickable / focusable area ≥ 44 × 44 px even though the glyph is 24 px. | NOT MEASURED |
| 6.2 | Timeline step markers, transport buttons (step back / play / step forward), A / B pair buttons.  | ≥ 44 × 44 px each.                                                      | NOT MEASURED |
| 6.3 | Tool rail buttons, Settings segmented buttons (Quality, Reduced motion), toggles, slider thumbs. | ≥ 44 × 44 px.                                                           | NOT MEASURED |
| 6.4 | 2D editor: vertex handles, per-point "Select" / "Delete" buttons, toolbar buttons.               | ≥ 44 × 44 px (or WCAG 2.5.8 spacing exception documented).              | NOT MEASURED |
| 6.5 | Modal close buttons.                                                                             | ≥ 44 × 44 px.                                                           | NOT MEASURED |

### 7. Screen-reader transcript

Use NVDA or Narrator. Browse mode on.

| #   | Steps                                                                                    | Expected                                                                                                                                                                                                                                               | Result       |
| --- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------ |
| 7.1 | On the mission route, find the heading "Mission transcript: The Sinking City".           | Present without opening anything.                                                                                                                                                                                                                      | NOT MEASURED |
| 7.2 | Read the whole transcript.                                                               | It contains: the briefing (question, location, dates, source, body), every temporal step with its date and availability ("No acquisition" for 5 Feb 2026 and 4 Aug 2026), the ROI corner coordinates, any diagnostics, and the verdict once validated. | NOT MEASURED |
| 7.3 | Check the labels `SIMULATED` (and `OFFLINE` / `STALE_EPHEMERIS` when active) are spoken. | Spoken as words, e.g. "Simulated data", "Alert: stale ephemeris".                                                                                                                                                                                      | NOT MEASURED |
| 7.4 | Check the verdict wording.                                                               | Says it is mission scoring against an authored reference mask, not a scientific measurement.                                                                                                                                                           | NOT MEASURED |
| 7.5 | Press "Show mission transcript".                                                         | The same text becomes visible on screen.                                                                                                                                                                                                               | NOT MEASURED |

### 8. Live-region announcements

Keep the screen reader running; do not move focus into the announcement area.

| #   | Steps                                                                                                                | Expected announcement (from `mission/controller.ts`)                                                                                 | Result       |
| --- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------ |
| 8.1 | Step onto 5 Feb 2026 (unavailable).                                                                                  | Assertive: "No acquisition on 2026-02-05. The satellite recorded nothing here on that pass." (`fmtDate` gives ISO dates)             | NOT MEASURED |
| 8.2 | With full motion, close the briefing (the watch auto-plays after 400 ms), or press Play from step 1, and let it run. | "Watch playing.", each date, a "No acquisition…" message for each skipped date, then "End of the record. Pick two dates to compare." | NOT MEASURED |
| 8.3 | Pause. Scrub with the pointer.                                                                                       | "Watch paused." / "Scrubbing the timeline." / "Paused on a date with no acquisition." as the state changes.                          | NOT MEASURED |
| 8.4 | View every available date.                                                                                           | "Every pass reviewed. Anomaly Detector unlocked."                                                                                    | NOT MEASURED |
| 8.5 | Mark corners on the globe.                                                                                           | "Corner N at <lat>, <lon>."                                                                                                          | NOT MEASURED |
| 8.6 | Validate an ROI that fails QA or the Δt rule.                                                                        | Assertive "No score: <reason>".                                                                                                      | NOT MEASURED |
| 8.7 | Save to the journal.                                                                                                 | "Saved to your Case Journal."                                                                                                        | NOT MEASURED |
| 8.8 | Scrub back and forth quickly over an unavailable date.                                                               | No flood of repeated "No acquisition" messages (the FSM de-duplicates).                                                              | NOT MEASURED |

## Summary

| Area                        | Result       | Notes |
| --------------------------- | ------------ | ----- |
| 1. Text zoom 200 %          | NOT MEASURED |       |
| 2. Reduced motion           | NOT MEASURED |       |
| 3. Contrast over imagery    | NOT MEASURED |       |
| 4. Keyboard-only ROI        | NOT MEASURED |       |
| 5. Focus ring               | NOT MEASURED |       |
| 6. Target size              | NOT MEASURED |       |
| 7. Screen-reader transcript | NOT MEASURED |       |
| 8. Live regions             | NOT MEASURED |       |
