use super::{Config, ShortcutManager, Snapshot, publish, save_config};
use ashpd::{
    WindowIdentifier,
    desktop::{
        Session,
        global_shortcuts::{GlobalShortcuts, NewShortcut, Shortcut},
    },
};
use futures_util::StreamExt;
use raw_window_handle::{HasDisplayHandle, HasWindowHandle};
use std::{
    collections::HashMap,
    sync::{Arc, atomic::Ordering},
    time::Duration,
};
use tauri::{AppHandle, Manager, WebviewWindow};

const ACTION: &str = "toggle-overlay";

pub(super) struct Binding {
    portal: Arc<GlobalShortcuts>,
    session: Arc<Session<GlobalShortcuts>>,
    listener: tauri::async_runtime::JoinHandle<()>,
    // ConfigureShortcuts returns before the system dialog closes. Keep its
    // exported parent valid until another configuration or session shutdown.
    parent: Option<WindowIdentifier>,
}

impl Binding {
    pub(super) async fn close(self) {
        self.listener.abort();
        let _ = self.session.close().await;
    }
}

fn preferred_trigger(shortcut: &str) -> String {
    shortcut
        .split('+')
        .map(|part| match part {
            "Ctrl" => "CTRL".into(),
            "Alt" => "ALT".into(),
            "Shift" => "SHIFT".into(),
            "Super" => "LOGO".into(),
            "Space" => "space".into(),
            "Enter" => "Return".into(),
            "PageUp" => "Prior".into(),
            "PageDown" => "Next".into(),
            other if other.len() == 1 => other.to_lowercase(),
            other => other.into(),
        })
        .collect::<Vec<String>>()
        .join("+")
}

fn effective(shortcuts: &[Shortcut]) -> Option<String> {
    shortcuts
        .iter()
        .find(|shortcut| shortcut.id() == ACTION)
        .map(|shortcut| shortcut.trigger_description().to_string())
        .filter(|value| !value.trim().is_empty())
}

fn matches_action(expected_session: &str, session: &str, action: &str) -> bool {
    session == expected_session && action == ACTION
}

/// Export the native main window for a parented system permission dialog.
/// Raw GTK/Wayland handles stay on the GTK thread; only the exported identifier
/// crosses back to the async command. The owning Tauri window remains alive.
async fn parent_identifier(window: Option<&WebviewWindow>) -> Option<WindowIdentifier> {
    let window = window?.clone();
    let handle = window.clone();
    let (sender, mut receiver) = tauri::async_runtime::channel(1);
    window
        .run_on_main_thread(move || {
            let raw_window = handle.window_handle().map(|value| value.as_raw());
            let raw_display = handle.display_handle().map(|value| value.as_raw());
            gtk::glib::MainContext::default().spawn_local(async move {
                let identifier = match (raw_window, raw_display) {
                    (Ok(window), Ok(display)) => {
                        WindowIdentifier::from_raw_handle(&window, Some(&display)).await
                    }
                    _ => None,
                };
                let _keep_window_alive = handle;
                let _ = sender.try_send(identifier);
            });
        })
        .ok()?;
    tokio::time::timeout(Duration::from_secs(5), receiver.recv())
        .await
        .ok()
        .flatten()
        .flatten()
}

pub(super) async fn apply(
    app: &AppHandle,
    window: Option<&WebviewWindow>,
    config: Config,
    interactive: bool,
) -> Result<Snapshot, String> {
    let manager = app.state::<ShortcutManager>();
    let parent = parent_identifier(window).await;
    let mut current = manager.portal.lock().await;
    if let Some(binding) = current.as_mut() {
        if manager.snapshot.lock().map_err(|e| e.to_string())?.status == "active" {
            if interactive {
                // Some Fedora backends expose this method while advertising v1.
                // Call it directly and handle UnknownMethod without destroying the
                // currently working binding. The desktop owns the final keybind.
                binding.portal.call::<_, _, ()>("ConfigureShortcuts", &(
                    binding.session.as_ref(), parent.as_ref().map(ToString::to_string).unwrap_or_default(),
                    HashMap::<String, ashpd::zvariant::Value<'_>>::new(),
                )).await.map_err(|_| "This desktop cannot edit shortcuts through the portal. Open Keyboard settings to change the shortcut; your current binding remains active.".to_string())?;
                binding.parent = parent;
                save_config(app, &config)?;
                return Ok(publish(app, |snapshot| {
                    snapshot.preferred = config.preferred;
                    snapshot.message = Some("Choose the shortcut in your desktop’s dialog. Alfred shows the approved binding when it changes.".into());
                }));
            }
            return Ok(manager.snapshot.lock().map_err(|e| e.to_string())?.clone());
        }
    }
    if let Some(old) = current.take() {
        old.close().await;
    }

    // Register the unsandboxed RPM identity on the same dedicated D-Bus connection
    // used by the portal, so GNOME can attribute and remember its permissions.
    let connection = ashpd::zbus::Connection::session()
        .await
        .map_err(|e| e.to_string())?;
    ashpd::register_host_app_with_connection(connection.clone(), "com.alfred.app".try_into().map_err(|_| "Invalid application identity")?)
        .await.map_err(|error| format!("The desktop could not identify Alfred: {error}. Install the current RPM, or use Keyboard settings with alfred --overlay."))?;
    let portal = Arc::new(GlobalShortcuts::with_connection(connection).await.map_err(|error| format!("Global shortcuts are unavailable: {error}. Use Keyboard settings with alfred --overlay."))?);
    let session = Arc::new(
        portal
            .create_session(Default::default())
            .await
            .map_err(|e| e.to_string())?,
    );
    let session_path = serde_json::to_value(session.as_ref())
        .map_err(|e| e.to_string())?
        .as_str()
        .ok_or("Invalid portal session")?
        .to_string();
    let result = async {
        // Subscribe before binding so an immediate approval/change cannot be lost.
        let activated = portal.receive_activated().await.map_err(|e| e.to_string())?;
        let changed = portal.receive_shortcuts_changed().await.map_err(|e| e.to_string())?;
        let owner = portal.receive_owner_changed().await.map_err(|e| e.to_string())?;
        let trigger = preferred_trigger(&config.preferred);
        let shortcuts = [NewShortcut::new(ACTION, "Open or hide Alfred’s quick overlay").preferred_trigger(trigger.as_str())];
        let request = tokio::time::timeout(Duration::from_secs(180), portal.bind_shortcuts(&session, &shortcuts, parent.as_ref(), Default::default()))
            .await.map_err(|_| "The shortcut permission request timed out. Try again.".to_string())?
            .map_err(|e| e.to_string())?;
        let response = request.response().map_err(|_| "The desktop did not approve the shortcut. You can try again or use Keyboard settings.".to_string())?;
        let binding = effective(response.shortcuts()).ok_or("No shortcut was assigned. Choose a binding in the desktop dialog and try again.")?;
        save_config(app, &config)?;
        Ok::<_, String>((activated, changed, owner, binding))
    }.await;
    let (mut activated, mut changed, mut owner, binding) = match result {
        Ok(value) => value,
        Err(error) => {
            let _ = session.close().await;
            return Err(error);
        }
    };
    let generation = manager.generation.fetch_add(1, Ordering::SeqCst) + 1;
    let app_handle = app.clone();
    let listener_session = session.clone();
    let listener = tauri::async_runtime::spawn(async move {
        let Ok(mut closed) = listener_session.receive_closed().await else {
            publish(&app_handle, |snapshot| {
                snapshot.status = "unavailable".into();
                snapshot.effective = None;
            });
            return;
        };
        loop {
            tokio::select! {
                event = activated.next() => {
                    let Some(event) = event else { break; };
                    if app_handle.state::<ShortcutManager>().generation.load(Ordering::SeqCst) != generation { return; }
                    if matches_action(&session_path, event.session_handle().as_str(), event.shortcut_id()) {
                        let token = event.options().get("activation_token")
                            .and_then(|value| value.downcast_ref::<&str>().ok()).map(str::to_owned);
                        crate::desktop::toggle_overlay_with_activation(&app_handle, token);
                    }
                }
                event = changed.next() => {
                    let Some(event) = event else { break; };
                    if app_handle.state::<ShortcutManager>().generation.load(Ordering::SeqCst) != generation { return; }
                    if event.session_handle().as_str() == session_path {
                        let assigned = effective(event.shortcuts());
                        publish(&app_handle, |snapshot| {
                            snapshot.status = if assigned.is_some() { "active" } else { "unavailable" }.into();
                            snapshot.effective = assigned; snapshot.message = None;
                        });
                    }
                }
                _ = closed.next() => { break; }
                _ = owner.next() => { break; }
            }
        }
        if app_handle
            .state::<ShortcutManager>()
            .generation
            .load(Ordering::SeqCst)
            == generation
        {
            publish(&app_handle, |snapshot| {
                snapshot.status = "unavailable".into();
                snapshot.effective = None;
                snapshot.message = Some(
                    "Your desktop shortcut session closed. Enable it again in Settings.".into(),
                );
            });
        }
    });
    *current = Some(Binding {
        portal,
        session,
        listener,
        parent,
    });
    Ok(publish(app, |snapshot| {
        snapshot.status = "active".into();
        snapshot.preferred = config.preferred;
        snapshot.effective = Some(binding);
        snapshot.message = None;
        snapshot.setup_dismissed = true;
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn maps_recorder_keys_to_freedesktop_triggers() {
        assert_eq!(preferred_trigger("Ctrl+Alt+Space"), "CTRL+ALT+space");
        assert_eq!(preferred_trigger("Shift+Super+K"), "SHIFT+LOGO+k");
        assert_eq!(preferred_trigger("Ctrl+Enter"), "CTRL+Return");
    }
    #[test]
    fn ignores_other_sessions_and_actions() {
        assert!(matches_action("/session/one", "/session/one", ACTION));
        assert!(!matches_action("/session/one", "/session/two", ACTION));
        assert!(!matches_action(
            "/session/one",
            "/session/one",
            "other-action"
        ));
    }
}
