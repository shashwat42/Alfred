#[cfg(desktop)]
mod desktop;
#[cfg(target_os = "windows")]
mod permissions;
#[cfg(target_os = "windows")]
mod updates;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default();

    #[cfg(target_os = "windows")]
    {
        builder = builder
            .manage(permissions::MicrophoneConsent::default())
            .manage(updates::UpdateState::default())
            .plugin(tauri_plugin_updater::Builder::new().build())
            .invoke_handler(tauri::generate_handler![
                permissions::request_microphone_consent,
                updates::check_for_app_update,
                updates::install_app_update
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
            for arg in argv {
                if arg.starts_with("alfred://") {
                    let _ = app.emit("alfred-deep-link", arg);
                }
            }
        }));

        builder = builder.plugin(tauri_plugin_global_shortcut::Builder::new().build());
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
                && let tauri::WindowEvent::CloseRequested { api, .. } = event
            {
                // Hide window instead of terminating application
                api.prevent_close();
                let _ = window.hide();
                if let Some(webview) = window.app_handle().get_webview_window("main") {
                    desktop::set_memory_target(&webview, true);
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
                use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

                app.deep_link().register("alfred")?;

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

                let _tray = tray_builder.build(app)?;

                // Register Global Shortcut: Alt+Space
                if let Ok(shortcut) = "Alt+Space".parse::<Shortcut>() {
                    let handle = app.handle().clone();
                    let _ = app
                        .global_shortcut()
                        .on_shortcut(shortcut, move |_app, _sc, event| {
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
