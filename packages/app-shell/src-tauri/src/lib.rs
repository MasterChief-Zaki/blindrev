//! BlindRev desktop shell (Tauri v2).
//!
//! The game itself is the Vite web app in `packages/app-shell`; this crate only hosts it in
//! WebView2. Opt-in diagnostics: set `BLINDREV_DIAGNOSTICS=1` (or pass `--diagnostics`) to write a
//! rotating log (5 MB per file, previous file kept) into the OS app-log directory,
//! e.g. `%LOCALAPPDATA%\bureau.blindrev.app\logs\blindrev.log`. Panics are logged when enabled.
//!
//! Measurement hook: `BLINDREV_WINDOW_SIZE=1920x1080` sets the main window's inner size (logical
//! px) at startup, clamped to the current monitor's work area. Used by `tools/webview2-drive.mjs`
//! for the SPEC §12 1080p runs; has no effect when unset.

use tauri::Manager;
use tauri_plugin_log::{RotationStrategy, Target, TargetKind};

const DIAGNOSTICS_ENV: &str = "BLINDREV_DIAGNOSTICS";
const WINDOW_SIZE_ENV: &str = "BLINDREV_WINDOW_SIZE";
/// Logical px kept free for the title bar / borders when clamping to the work area.
const FRAME_ALLOWANCE: f64 = 40.0;

fn parse_size(spec: &str) -> Option<(f64, f64)> {
    let (w, h) = spec.trim().split_once(['x', 'X'])?;
    let (w, h) = (w.trim().parse::<f64>().ok()?, h.trim().parse::<f64>().ok()?);
    (w >= 640.0 && h >= 480.0).then_some((w, h))
}

/// Applies `BLINDREV_WINDOW_SIZE` (if set) to the main window, clamped to the monitor work area.
fn apply_window_size_override(app: &tauri::App) {
    let Some((mut w, mut h)) = std::env::var(WINDOW_SIZE_ENV)
        .ok()
        .and_then(|s| parse_size(&s))
    else {
        return;
    };
    let Some(win) = app.get_webview_window("main") else {
        return;
    };
    if let Ok(Some(mon)) = win.current_monitor() {
        let scale = mon.scale_factor();
        let area = mon.work_area();
        w = w.min(f64::from(area.size.width) / scale - FRAME_ALLOWANCE / 2.0);
        h = h.min(f64::from(area.size.height) / scale - FRAME_ALLOWANCE);
    }
    let _ = win.set_size(tauri::LogicalSize::new(w, h));
    let _ = win.center();
}
const MAX_LOG_BYTES: u128 = 5 * 1024 * 1024;

/// True when the user opted in to diagnostic logging (env var or CLI flag).
pub fn diagnostics_enabled() -> bool {
    let env_on = std::env::var(DIAGNOSTICS_ENV)
        .map(|v| {
            matches!(
                v.trim().to_ascii_lowercase().as_str(),
                "1" | "true" | "yes" | "on"
            )
        })
        .unwrap_or(false);
    env_on || std::env::args().any(|a| a == "--diagnostics")
}

/// Tells the frontend whether diagnostics are on (so the HUD can say so).
#[tauri::command]
fn diagnostics_status() -> bool {
    diagnostics_enabled()
}

fn log_plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    tauri_plugin_log::Builder::new()
        .clear_targets()
        .target(Target::new(TargetKind::LogDir {
            file_name: Some("blindrev".into()),
        }))
        .target(Target::new(TargetKind::Webview))
        .level(log::LevelFilter::Info)
        .max_file_size(MAX_LOG_BYTES)
        .rotation_strategy(RotationStrategy::KeepOne)
        .build()
}

pub fn run() {
    let diagnostics = diagnostics_enabled();
    let mut builder =
        tauri::Builder::default().invoke_handler(tauri::generate_handler![diagnostics_status]);
    if diagnostics {
        builder = builder.plugin(log_plugin());
        let default_hook = std::panic::take_hook();
        std::panic::set_hook(Box::new(move |info| {
            log::error!("panic: {info}");
            default_hook(info);
        }));
    }
    builder
        .setup(move |app| {
            apply_window_size_override(app);
            if diagnostics {
                log::info!(
                    "BlindRev {} starting (diagnostics on)",
                    app.package_info().version
                );
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running BlindRev");
}
