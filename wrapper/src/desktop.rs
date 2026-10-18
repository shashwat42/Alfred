use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{Emitter, Manager};

static TOGGLING_OVERLAY: AtomicBool = AtomicBool::new(false);

/// WebView creation must run outside Windows' synchronous event handlers.
pub fn toggle_overlay(app: &tauri::AppHandle) {
    if TOGGLING_OVERLAY.swap(true, Ordering::AcqRel) {
        return;
    }
    let app = app.clone();
    std::thread::spawn(move || {
        if let Err(error) = toggle_overlay_inner(&app) {
            log::warn!("Could not toggle overlay: {error}");
        }
        TOGGLING_OVERLAY.store(false, Ordering::Release);
    });
}

fn toggle_overlay_inner(app: &tauri::AppHandle) -> tauri::Result<()> {
    if let Some(overlay) = app.get_webview_window("overlay") {
        if overlay.is_visible()? {
            overlay.emit("alfred:overlay-hidden", ())?;
            overlay.hide()?;
            set_memory_target(&overlay, true);
        } else {
            set_memory_target(&overlay, false);
            overlay.center()?;
            overlay.show()?;
            overlay.unminimize()?;
            overlay.set_focus()?;
            overlay.emit("alfred:overlay-summon", ())?;
        }
    } else if let Some(config) = app
        .config()
        .app
        .windows
        .iter()
        .find(|c| c.label == "overlay")
    {
        // Keep the existing configured appearance and permissions, but pay for
        // the second renderer only when the user actually opens the overlay.
        let overlay = tauri::WebviewWindowBuilder::from_config(app, config)?
            .visible(true)
            .build()?;
        overlay.set_focus()?;
    }
    Ok(())
}

pub fn set_memory_target(window: &tauri::WebviewWindow, inactive: bool) {
    #[cfg(target_os = "windows")]
    {
        use webview2_com::Microsoft::Web::WebView2::Win32::{
            COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW,
            COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL, ICoreWebView2_19,
        };
        use windows_core::Interface;

        let _ = window.with_webview(move |webview| unsafe {
            if let Ok(core) = webview.controller().CoreWebView2()
                && let Ok(core) = core.cast::<ICoreWebView2_19>()
            {
                let level = if inactive {
                    COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW
                } else {
                    COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL
                };
                // Older runtimes may lack this optional interface. Do not
                // suspend scripts: the main view owns reminder delivery.
                let _ = core.SetMemoryUsageTargetLevel(level);
            }
        });
    }
    #[cfg(not(target_os = "windows"))]
    let _ = (window, inactive);
}
