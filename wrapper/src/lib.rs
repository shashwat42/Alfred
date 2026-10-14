#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default();

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

        builder = builder.on_window_event(|window, event| {
            if window.label() == "main"
                && let tauri::WindowEvent::CloseRequested { api, .. } = event
            {
                // Hide window instead of terminating application
                api.prevent_close();
                let _ = window.hide();
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

                if let (Some(window), Some(icon)) =
                    (app.get_webview_window("main"), app.default_window_icon())
                {
                    let _ = window.set_icon(icon.clone());
                }

                if let Some(overlay) = app.get_webview_window("overlay") {
                    let _ = overlay.set_decorations(false);
                    let _ = overlay.set_shadow(false);
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

                let mut tray_builder = TrayIconBuilder::new()
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
                            if let Some(overlay) = app.get_webview_window("overlay") {
                                let is_vis = overlay.is_visible().unwrap_or(false);
                                if is_vis {
                                    let _ = overlay.hide();
                                } else {
                                    let _ = overlay.center();
                                    let _ = overlay.show();
                                    let _ = overlay.unminimize();
                                    let _ = overlay.set_focus();
                                    let _ = app.emit("alfred:overlay-summon", ());
                                }
                            }
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
                                } else {
                                    let _ = window.show();
                                    let _ = window.unminimize();
                                    let _ = window.set_focus();
                                }
                            }
                        }
                    });

                if let Some(icon) = app.default_window_icon() {
                    tray_builder = tray_builder.icon(icon.clone());
                }

                let _tray = tray_builder.build(app)?;

                // Register Global Shortcut: Alt+Space
                if let Ok(shortcut) = "Alt+Space".parse::<Shortcut>() {
                    let handle = app.handle().clone();
                    let _ = app
                        .global_shortcut()
                        .on_shortcut(shortcut, move |_app, _sc, event| {
                            if event.state() == ShortcutState::Pressed
                                && let Some(overlay) = handle.get_webview_window("overlay")
                            {
                                let is_vis = overlay.is_visible().unwrap_or(false);
                                if is_vis {
                                    let _ = overlay.hide();
                                } else {
                                    let _ = overlay.center();
                                    let _ = overlay.show();
                                    let _ = overlay.unminimize();
                                    let _ = overlay.set_focus();
                                    let _ = handle.emit("alfred:overlay-summon", ());
                                }
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
