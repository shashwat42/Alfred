use tauri::{Emitter, Manager};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let mut builder = tauri::Builder::default();

  #[cfg(desktop)]
  {
    builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
      if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.set_focus();
      }
      for arg in argv {
        if arg.starts_with("alfred://") {
          let _ = app.emit("alfred-deep-link", arg);
        }
      }
    }));
  }

  builder
    .plugin(tauri_plugin_opener::init())
    .plugin(tauri_plugin_deep_link::init())
    .setup(|app| {
      #[cfg(desktop)]
      {
        use tauri_plugin_deep_link::DeepLinkExt;
        app.deep_link().register("alfred")?;

        if let Some(window) = app.get_webview_window("main") {
          if let Some(icon) = app.default_window_icon() {
            let _ = window.set_icon(icon.clone());
          }
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
