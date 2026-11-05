#[cfg(desktop)]
mod desktop;
#[cfg(any(target_os = "windows", target_os = "linux"))]
mod origin;
#[cfg(target_os = "linux")]
#[path = "permissions_linux.rs"]
mod permissions;
#[cfg(target_os = "windows")]
mod permissions;
#[cfg(any(target_os = "windows", target_os = "linux"))]
mod shortcuts;
#[cfg(target_os = "linux")]
#[path = "startup_linux.rs"]
mod startup;
#[cfg(target_os = "windows")]
mod startup;
#[cfg(target_os = "windows")]
mod updates;
#[cfg(target_os = "linux")]
#[path = "updates_linux.rs"]
mod updates;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default();

    #[cfg(target_os = "windows")]
    {
        builder = builder
            .manage(permissions::MicrophoneConsent::default())
            .manage(shortcuts::ShortcutManager::default())
            .manage(updates::UpdateState::default())
            .plugin(tauri_plugin_updater::Builder::new().build())
            .invoke_handler(tauri::generate_handler![
                permissions::request_microphone_consent,
                shortcuts::get_overlay_shortcut,
                shortcuts::configure_overlay_shortcut,
                shortcuts::dismiss_overlay_shortcut_setup,
                shortcuts::open_overlay_keyboard_settings,
                updates::check_for_app_update,
                updates::install_app_update,
                startup::get_launch_on_startup,
                startup::set_launch_on_startup
            ])
            .on_permission_request(permissions::handle_permission);
    }

    #[cfg(target_os = "linux")]
    {
        builder = builder
            .manage(permissions::MicrophoneConsent::default())
            .manage(shortcuts::ShortcutManager::default())
            .manage(updates::UpdateState::default())
            .invoke_handler(tauri::generate_handler![
                permissions::request_microphone_consent,
                updates::check_for_app_update,
                updates::install_app_update,
                shortcuts::get_overlay_shortcut,
                shortcuts::configure_overlay_shortcut,
                shortcuts::dismiss_overlay_shortcut_setup,
                shortcuts::open_overlay_keyboard_settings,
                startup::get_launch_on_startup,
                startup::set_launch_on_startup
            ])
            .on_permission_request(permissions::handle_permission);
    }

    #[cfg(desktop)]
    {
        use tauri::{Emitter, Manager};

        builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
            if argv.iter().any(|arg| arg == "--overlay") {
                desktop::toggle_overlay(app);
            }
            for arg in argv {
                if arg.starts_with("alfred://") {
                    let _ = app.emit("alfred-deep-link", arg);
                }
            }
        }));

        // The current shortcut backend uses X11. Wayland users bind `alfred --overlay`
        // in their desktop settings instead; do not fail startup without X11.
        if desktop::supports_global_shortcut() {
            builder = builder.plugin(tauri_plugin_global_shortcut::Builder::new().build());
        }
        builder = builder.plugin(tauri_plugin_notification::init());

        builder = builder.on_window_event(|window, event| {
            if let Some(webview) = window.app_handle().get_webview_window(window.label()) {
                match event {
                    tauri::WindowEvent::Focused(true) => {
                        desktop::set_memory_target(&webview, false)
                    }
                    tauri::WindowEvent::Resized(_) => desktop::set_memory_target(
                        &webview,
                        window.is_minimized().unwrap_or(false)
                            || !window.is_visible().unwrap_or(true),
                    ),
                    _ => {}
                }
            }
            if window.label() == "main"
                && let tauri::WindowEvent::CloseRequested { api: _api, .. } = event
            {
                #[cfg(target_os = "linux")]
                {
                    // GNOME does not expose tray icons by default. Never strand
                    // a hidden app or leave reminder processes running after Close.
                    window.app_handle().exit(0);
                    return;
                }
                #[cfg(not(target_os = "linux"))]
                {
                    // Hide window instead of terminating application
                    _api.prevent_close();
                    let _ = window.hide();
                    if let Some(webview) = window.app_handle().get_webview_window("main") {
                        desktop::set_memory_target(&webview, true);
                    }
                }
            }
        });
    }

    builder
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_deep_link::init())
        .setup(|app| {
            #[cfg(desktop)]
            {
                use tauri::{
                    Emitter, Manager,
                    menu::{Menu, MenuItem, PredefinedMenuItem},
                    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
                };
                use tauri_plugin_deep_link::DeepLinkExt;
                #[cfg(not(any(target_os = "windows", target_os = "linux")))]
                use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

                if let Err(error) = app.deep_link().register("alfred") {
                    log::warn!("Could not register Alfred deep links: {error}");
                }
                if std::env::args().any(|arg| arg == "--overlay") {
                    desktop::toggle_overlay(app.handle());
                }

                if let Some(window) = app.get_webview_window("main") {
                    // Supply the full-size artwork directly for the taskbar instead of
                    // relying on the default icon loaded from Windows resources.
                    window.set_icon(tauri::include_image!("icons/icon.png"))?;
                }

                // Setup System Tray
                let open_i = MenuItem::with_id(app, "open", "Open Alfred", true, None::<&str>)?;
                let overlay_i =
                    MenuItem::with_id(app, "overlay", "Quick Overlay", true, None::<&str>)?;
                let settings_i =
                    MenuItem::with_id(app, "settings", "Settings", true, None::<&str>)?;
                let separator = PredefinedMenuItem::separator(app)?;
                let quit_i = MenuItem::with_id(app, "quit", "Quit Alfred", true, None::<&str>)?;

                let tray_menu = Menu::with_items(
                    app,
                    &[&open_i, &overlay_i, &settings_i, &separator, &quit_i],
                )?;

                let tray_builder = TrayIconBuilder::new()
                    .icon(tauri::include_image!("icons/tray-icon.png"))
                    .menu(&tray_menu)
                    .tooltip("Alfred")
                    .on_menu_event(|app, event| match event.id().as_ref() {
                        "open" => {
                            if let Some(w) = app.get_webview_window("main") {
                                let _ = w.show();
                                let _ = w.unminimize();
                                let _ = w.set_focus();
                            }
                        }
                        "overlay" => {
                            desktop::toggle_overlay(app);
                        }
                        "settings" => {
                            if let Some(w) = app.get_webview_window("main") {
                                let _ = w.show();
                                let _ = w.unminimize();
                                let _ = w.set_focus();
                                let _ = app.emit("alfred:navigate", "settings");
                            }
                        }
                        "quit" => {
                            app.exit(0);
                        }
                        _ => {}
                    })
                    .on_tray_icon_event(|tray, event| {
                        if let TrayIconEvent::Click {
                            button: MouseButton::Left,
                            button_state: MouseButtonState::Up,
                            ..
                        } = event
                        {
                            let app = tray.app_handle();
                            if let Some(window) = app.get_webview_window("main") {
                                let is_visible = window.is_visible().unwrap_or(false);
                                if is_visible {
                                    let _ = window.hide();
                                    desktop::set_memory_target(&window, true);
                                } else {
                                    let _ = window.show();
                                    let _ = window.unminimize();
                                    let _ = window.set_focus();
                                }
                            }
                        }
                    });

                match tray_builder.build(app) {
                    Ok(_tray) => {}
                    Err(error) => log::warn!("System tray unavailable: {error}"),
                }

                #[cfg(any(target_os = "windows", target_os = "linux"))]
                shortcuts::initialize(app.handle());
                #[cfg(not(any(target_os = "windows", target_os = "linux")))]
                if let Ok(shortcut) = "Alt+Space".parse::<Shortcut>() {
                    let handle = app.handle().clone();
                    let _ = app
                        .global_shortcut()
                        .on_shortcut(shortcut, move |_, _, event| {
                            if event.state() == ShortcutState::Pressed {
                                desktop::toggle_overlay(&handle);
                            }
                        });
                }
            }
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while building tauri application");
}
