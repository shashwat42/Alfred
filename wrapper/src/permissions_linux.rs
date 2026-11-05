use std::sync::atomic::{AtomicBool, Ordering};
use gtk::prelude::*;
use tauri::{Manager, State, Webview, WebviewWindow, webview::{PermissionKind, PermissionResponse}};

#[derive(Default)]
pub struct MicrophoneConsent { granted: AtomicBool, prompting: AtomicBool }

pub fn handle_permission(webview: Webview, kind: PermissionKind) -> PermissionResponse {
    if kind != PermissionKind::Microphone { return PermissionResponse::Default; }
    if matches!(webview.label(), "main" | "overlay")
        && webview.url().is_ok_and(|url| crate::origin::trusted_origin(&url))
        && webview.state::<MicrophoneConsent>().granted.load(Ordering::SeqCst)
    { PermissionResponse::Allow } else { PermissionResponse::Deny }
}

#[tauri::command]
pub async fn request_microphone_consent(window: WebviewWindow, consent: State<'_, MicrophoneConsent>) -> Result<bool, String> {
    if !matches!(window.label(), "main" | "overlay") || !window.url().is_ok_and(|url| crate::origin::trusted_origin(&url)) {
        return Err("Microphone requests must come from Alfred.".into());
    }
    if consent.granted.load(Ordering::SeqCst) { return Ok(true); }
    if consent.prompting.swap(true, Ordering::SeqCst) { return Err("A microphone permission request is already open.".into()); }
    let (sender, receiver) = tauri::async_runtime::channel(1);
    let handle = window.clone();
    if let Err(error) = window.run_on_main_thread(move || {
        let result = handle.gtk_window().map(|parent| {
            let dialog = gtk::MessageDialog::new(Some(&parent), gtk::DialogFlags::MODAL,
                gtk::MessageType::Question, gtk::ButtonsType::YesNo,
                "Allow Alfred to use your microphone for voice input?");
            dialog.set_title("Alfred");
            dialog.set_default_response(gtk::ResponseType::No);
            let allowed = dialog.run() == gtk::ResponseType::Yes;
            dialog.close();
            allowed
        }).map_err(|error| error.to_string());
        let _ = sender.try_send(result);
    }) {
        consent.prompting.store(false, Ordering::SeqCst);
        return Err(error.to_string());
    }
    let mut receiver = receiver;
    let result = receiver.recv().await.ok_or("Microphone prompt closed unexpectedly.");
    consent.prompting.store(false, Ordering::SeqCst);
    let allowed = result??;
    consent.granted.store(allowed, Ordering::SeqCst);
    Ok(allowed)
}
