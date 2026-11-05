use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::PathBuf,
    sync::{
        Mutex,
        atomic::{AtomicU64, Ordering},
    },
};
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

#[cfg(target_os = "linux")]
mod portal;

pub const CHANGED: &str = "alfred:overlay-shortcut-changed";
const DEFAULT_LINUX: &str = "Ctrl+Alt+Space";

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Config {
    enabled: bool,
    preferred: String,
    setup_dismissed: bool,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            enabled: cfg!(target_os = "windows"),
            preferred: if cfg!(target_os = "linux") {
                DEFAULT_LINUX
            } else {
                "Alt+Space"
            }
            .into(),
            setup_dismissed: false,
        }
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    backend: &'static str,
    status: String,
    preferred: String,
    effective: Option<String>,
    message: Option<String>,
    setup_dismissed: bool,
}

impl Default for Snapshot {
    fn default() -> Self {
        Self {
            backend: if uses_portal() { "portal" } else { "native" },
            status: "initializing".into(),
            preferred: Config::default().preferred,
            effective: None,
            message: None,
            setup_dismissed: false,
        }
    }
}

#[derive(Default)]
pub struct ShortcutManager {
    snapshot: Mutex<Snapshot>,
    operation: tauri::async_runtime::Mutex<()>,
    native: Mutex<Option<Shortcut>>,
    generation: AtomicU64,
    #[cfg(target_os = "linux")]
    portal: tauri::async_runtime::Mutex<Option<portal::Binding>>,
}

fn uses_portal() -> bool {
    cfg!(target_os = "linux") && !crate::desktop::supports_global_shortcut()
}

fn authorize(window: &WebviewWindow) -> Result<(), String> {
    if window.label() != "main"
        || !window
            .url()
            .is_ok_and(|url| crate::origin::trusted_origin(&url))
    {
        return Err("Overlay shortcuts can only be changed from Alfred settings.".into());
    }
    Ok(())
}

fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?
        .join("overlay-shortcut.json"))
}

fn read_config(app: &AppHandle) -> Result<Config, String> {
    match fs::read(config_path(app)?) {
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(|_| {
            "Your saved overlay shortcut could not be read. Choose a new shortcut in Settings."
                .into()
        }),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Config::default()),
        Err(error) => Err(error.to_string()),
    }
}

fn save_config(app: &AppHandle, config: &Config) -> Result<(), String> {
    let path = config_path(app)?;
    fs::create_dir_all(path.parent().ok_or("Invalid configuration directory")?)
        .map_err(|e| e.to_string())?;
    let temporary = path.with_extension("tmp");
    fs::write(
        &temporary,
        serde_json::to_vec(config).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    fs::rename(&temporary, &path).map_err(|e| e.to_string())
}

/// Accept the same deliberately small grammar as the key recorder, rather than
/// interpreting arbitrary shell commands or compositor-specific syntax.
fn normalize(preferred: &str) -> Result<String, String> {
    let parts: Vec<_> = preferred.split('+').collect();
    if parts.len() < 2 || parts.len() > 5 {
        return Err("Use Ctrl, Alt or Super together with a key.".into());
    }
    let (key, modifiers) = parts.split_last().ok_or("Choose a shortcut.")?;
    let mut seen = std::collections::HashSet::new();
    for modifier in modifiers {
        if !matches!(*modifier, "Ctrl" | "Alt" | "Shift" | "Super") || !seen.insert(*modifier) {
            return Err("Invalid or repeated shortcut modifier.".into());
        }
    }
    if !modifiers
        .iter()
        .any(|value| matches!(*value, "Ctrl" | "Alt" | "Super"))
    {
        return Err("Include Ctrl, Alt or Super in your shortcut.".into());
    }
    let valid_key = (key.len() == 1 && key.as_bytes()[0].is_ascii_alphanumeric())
        || matches!(
            *key,
            "Space"
                | "Enter"
                | "Tab"
                | "Escape"
                | "Home"
                | "End"
                | "PageUp"
                | "PageDown"
                | "Up"
                | "Down"
                | "Left"
                | "Right"
        )
        || key
            .strip_prefix('F')
            .and_then(|value| value.parse::<u8>().ok())
            .is_some_and(|value| (1..=24).contains(&value));
    if !valid_key {
        return Err("Choose a letter, number, function key or navigation key.".into());
    }
    let mut normalized: Vec<&str> = ["Ctrl", "Alt", "Shift", "Super"]
        .into_iter()
        .filter(|modifier| seen.contains(modifier))
        .collect();
    normalized.push(key);
    let normalized = normalized.join("+");
    normalized
        .parse::<Shortcut>()
        .map_err(|_| "This shortcut is not supported.".to_string())?;
    Ok(normalized)
}

fn publish(app: &AppHandle, update: impl FnOnce(&mut Snapshot)) -> Snapshot {
    let manager = app.state::<ShortcutManager>();
    let mut snapshot = manager.snapshot.lock().unwrap_or_else(|e| e.into_inner());
    update(&mut snapshot);
    let result = snapshot.clone();
    let _ = app.emit_to("main", CHANGED, &result);
    result
}

#[tauri::command]
pub fn get_overlay_shortcut(
    window: WebviewWindow,
    state: State<'_, ShortcutManager>,
) -> Result<Snapshot, String> {
    authorize(&window)?;
    Ok(state.snapshot.lock().map_err(|e| e.to_string())?.clone())
}

#[tauri::command]
pub async fn dismiss_overlay_shortcut_setup(
    window: WebviewWindow,
    app: AppHandle,
    state: State<'_, ShortcutManager>,
) -> Result<Snapshot, String> {
    authorize(&window)?;
    let _operation = state
        .operation
        .try_lock()
        .map_err(|_| "Finish the open shortcut request first.")?;
    let mut config = read_config(&app)?;
    config.setup_dismissed = true;
    save_config(&app, &config)?;
    Ok(publish(&app, |snapshot| snapshot.setup_dismissed = true))
}

async fn apply(
    app: &AppHandle,
    window: Option<&WebviewWindow>,
    config: Config,
    interactive: bool,
) -> Result<Snapshot, String> {
    let manager = app.state::<ShortcutManager>();
    if !config.enabled {
        #[cfg(target_os = "linux")]
        if let Some(binding) = manager.portal.lock().await.take() {
            manager.generation.fetch_add(1, Ordering::SeqCst);
            binding.close().await;
        }
        let old = *manager.native.lock().map_err(|e| e.to_string())?;
        if let Some(old) = old {
            app.global_shortcut()
                .unregister(old)
                .map_err(|e| e.to_string())?;
            *manager.native.lock().map_err(|e| e.to_string())? = None;
        }
        let snapshot = publish(app, |snapshot| {
            snapshot.status = "disabled".into();
            snapshot.effective = None;
            snapshot.setup_dismissed = true;
            snapshot.message = None;
        });
        // Report actual OS state even if saving the restart preference fails.
        save_config(app, &config)?;
        return Ok(snapshot);
    }
    #[cfg(target_os = "linux")]
    if uses_portal() {
        let fallback = app.get_webview_window("main");
        return portal::apply(app, window.or(fallback.as_ref()), config, interactive).await;
    }
    let _ = (window, interactive);
    let shortcut = config
        .preferred
        .parse::<Shortcut>()
        .map_err(|e| e.to_string())?;
    let old = *manager.native.lock().map_err(|e| e.to_string())?;
    if old != Some(shortcut) {
        let handle = app.clone();
        app.global_shortcut().on_shortcut(shortcut, move |_, _, event| {
            if event.state() == ShortcutState::Pressed { crate::desktop::toggle_overlay(&handle); }
        }).map_err(|_| "That shortcut is already in use or could not be registered. Your previous shortcut remains active.".to_string())?;
    }
    let previous = Config {
        enabled: old.is_some(),
        preferred: manager
            .snapshot
            .lock()
            .map_err(|e| e.to_string())?
            .preferred
            .clone(),
        setup_dismissed: true,
    };
    if let Err(error) = save_config(app, &config) {
        if old != Some(shortcut) {
            let _ = app.global_shortcut().unregister(shortcut);
        }
        return Err(error);
    }
    if let Some(old) = old.filter(|old| *old != shortcut) {
        if app.global_shortcut().unregister(old).is_err() {
            let _ = app.global_shortcut().unregister(shortcut);
            let _ = save_config(app, &previous);
            return Err("Could not replace the old shortcut. Your previous binding is still selected; try again.".into());
        }
    }
    *manager.native.lock().map_err(|e| e.to_string())? = Some(shortcut);
    Ok(publish(app, |snapshot| {
        snapshot.status = "active".into();
        snapshot.preferred = config.preferred.clone();
        snapshot.effective = Some(config.preferred);
        snapshot.message = None;
        snapshot.setup_dismissed = true;
    }))
}

#[tauri::command]
pub async fn configure_overlay_shortcut(
    window: WebviewWindow,
    app: AppHandle,
    state: State<'_, ShortcutManager>,
    preferred: String,
    enabled: bool,
) -> Result<Snapshot, String> {
    authorize(&window)?;
    let preferred = normalize(&preferred)?;
    let _operation = state
        .operation
        .try_lock()
        .map_err(|_| "A shortcut request is already open. Finish or cancel it first.")?;
    let result = apply(
        &app,
        Some(&window),
        Config {
            preferred,
            enabled,
            setup_dismissed: true,
        },
        true,
    )
    .await;
    if let Err(error) = &result {
        publish(&app, |snapshot| {
            snapshot.message = Some(error.clone());
        });
    }
    result
}

#[tauri::command]
pub fn open_overlay_keyboard_settings(window: WebviewWindow) -> Result<(), String> {
    authorize(&window)?;
    #[cfg(target_os = "linux")]
    {
        let desktop = std::env::var("XDG_CURRENT_DESKTOP")
            .unwrap_or_default()
            .to_lowercase();
        let (program, argument) = if desktop.contains("kde") {
            ("systemsettings", "kcm_keys")
        } else {
            ("gnome-control-center", "keyboard")
        };
        std::process::Command::new(program).arg(argument).spawn().map_err(|_| "Open your desktop’s Keyboard settings and add a custom shortcut for alfred --overlay.".to_string())?;
        Ok(())
    }
    #[cfg(not(target_os = "linux"))]
    Err("Use Alfred’s shortcut controls on this platform.".into())
}

pub fn initialize(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let manager = app.state::<ShortcutManager>();
        let _operation = manager.operation.lock().await;
        let config = match read_config(&app) {
            Ok(mut config) => match normalize(&config.preferred) {
                Ok(preferred) => {
                    config.preferred = preferred;
                    config
                }
                Err(error) => {
                    publish(&app, |snapshot| {
                        snapshot.message = Some(error);
                        snapshot.status = "unavailable".into();
                    });
                    return;
                }
            },
            Err(error) => {
                publish(&app, |snapshot| {
                    snapshot.message = Some(error);
                    snapshot.status = "unavailable".into();
                });
                return;
            }
        };
        publish(&app, |snapshot| {
            snapshot.preferred = config.preferred.clone();
            snapshot.setup_dismissed = config.setup_dismissed;
            if !config.enabled {
                snapshot.status = if config.setup_dismissed {
                    "disabled"
                } else {
                    "unconfigured"
                }
                .into();
            }
        });
        if config.enabled {
            if let Err(error) = apply(&app, None, config, false).await {
                publish(&app, |snapshot| {
                    snapshot.status = "unavailable".into();
                    snapshot.message = Some(error);
                });
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn shortcuts_reject_unmodified_keys_and_arbitrary_commands() {
        for value in [
            "Space",
            "Shift+A",
            "Ctrl+Ctrl+A",
            "Ctrl+;",
            "Ctrl+$(command)",
            "Ctrl+F25",
            "Ctrl+Alt+",
        ] {
            assert!(normalize(value).is_err(), "Accepted {value}");
        }
        assert_eq!(normalize("Alt+Ctrl+Space").unwrap(), "Ctrl+Alt+Space");
        assert_eq!(normalize("Super+Shift+K").unwrap(), "Shift+Super+K");
    }
}
