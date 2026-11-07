use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{Emitter, Manager};

static TOGGLING_OVERLAY: AtomicBool = AtomicBool::new(false);

#[cfg(target_os = "linux")]
#[tauri::command]
pub fn quit_alfred(window: tauri::WebviewWindow) -> Result<(), String> {
    if window.label() != "main"
        || !window
            .url()
            .is_ok_and(|url| crate::origin::trusted_origin(&url))
    {
        return Err("Quit Alfred must come from the main window.".into());
    }
    window.app_handle().exit(0);
    Ok(())
}

#[cfg(any(target_os = "windows", target_os = "linux"))]
#[tauri::command]
pub fn notification_device_name(window: tauri::WebviewWindow) -> Option<String> {
    if window.label() != "main"
        || !window.url().is_ok_and(|url| crate::origin::trusted_origin(&url))
    {
        return None;
    }
    #[cfg(target_os = "windows")]
    return std::env::var("COMPUTERNAME").ok();
    #[cfg(target_os = "linux")]
    return std::fs::read_to_string("/proc/sys/kernel/hostname").ok();
}

pub fn supports_global_shortcut() -> bool {
    !cfg!(target_os = "linux")
        || (std::env::var_os("WAYLAND_DISPLAY").is_none()
            && std::env::var("XDG_SESSION_TYPE").is_ok_and(|value| value == "x11"))
}

/// WebView creation must run outside Windows' synchronous event handlers.
pub fn toggle_overlay(app: &tauri::AppHandle) {
    toggle_overlay_with_activation(app, None);
}

pub fn toggle_overlay_with_activation(app: &tauri::AppHandle, token: Option<String>) {
    if TOGGLING_OVERLAY.swap(true, Ordering::AcqRel) {
        return;
    }
    let app = app.clone();
    std::thread::spawn(move || {
        if let Err(error) = toggle_overlay_inner(&app, token) {
            log::warn!("Could not toggle overlay: {error}");
        }
        TOGGLING_OVERLAY.store(false, Ordering::Release);
    });
}

fn toggle_overlay_inner(app: &tauri::AppHandle, token: Option<String>) -> tauri::Result<()> {
    if let Some(overlay) = app.get_webview_window("overlay") {
        if overlay.is_visible()? {
            overlay.emit("alfred:overlay-hidden", ())?;
            overlay.hide()?;
            set_memory_target(&overlay, true);
        } else {
            set_memory_target(&overlay, false);
            overlay.show()?;
            overlay.unminimize()?;
            overlay.set_focus()?;
            activate_overlay(&overlay, token);
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
        let builder = tauri::WebviewWindowBuilder::from_config(app, config)?.visible(false);
        // Wayland places toplevel windows. Maximize the transparent surface so
        // the chat can align itself with the top of the monitor's work area.
        #[cfg(target_os = "linux")]
        let builder = if std::env::var_os("WAYLAND_DISPLAY").is_some()
            || std::env::var("XDG_SESSION_TYPE").is_ok_and(|value| value == "wayland")
        {
            builder.resizable(true).maximized(true)
        } else {
            builder
        };
        let overlay = builder.build()?;
        activate_overlay(&overlay, token);
    }
    Ok(())
}

#[cfg(any(target_os = "windows", target_os = "linux"))]
pub fn dismiss_unfocused_overlay(window: &tauri::Window) {
    if !TOGGLING_OVERLAY.load(Ordering::Acquire)
        && window.is_visible().unwrap_or(false)
        && !window.state::<crate::permissions::MicrophoneConsent>().is_prompting()
    {
        let _ = window.close();
    }
}

fn activate_overlay(window: &tauri::WebviewWindow, token: Option<String>) {
    #[cfg(target_os = "linux")]
    if let Some(token) = token {
        use gtk::prelude::*;
        let handle = window.clone();
        let _ = window.run_on_main_thread(move || {
            if let Ok(native) = handle.gtk_window() {
                native.set_startup_id(&token);
                native.present();
            }
        });
    }
    #[cfg(not(target_os = "linux"))]
    let _ = (window, token);
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
