use std::sync::{
    Arc, Mutex,
    atomic::{AtomicBool, Ordering},
};
use tauri::{
    Manager, State, Webview, WebviewWindow,
    webview::{PermissionKind, PermissionResponse},
};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    IDYES, MB_DEFBUTTON2, MB_ICONQUESTION, MB_YESNO, MessageBoxW,
};

#[derive(Clone, Default)]
pub struct MicrophoneConsent {
    granted: Arc<AtomicBool>,
    prompt: Arc<Mutex<()>>,
}

fn trusted_origin(url: &tauri::Url) -> bool {
    if !url.username().is_empty() || url.password().is_some() {
        return false;
    }
    match (url.scheme(), url.host_str(), url.port()) {
        ("http" | "https", Some("tauri.localhost"), None) => true,
        ("http", Some("localhost" | "127.0.0.1"), Some(5173)) => cfg!(debug_assertions),
        _ => false,
    }
}

pub fn handle_permission(webview: Webview, kind: PermissionKind) -> PermissionResponse {
    if kind != PermissionKind::Microphone {
        return PermissionResponse::Default;
    }
    let trusted = matches!(webview.label(), "main" | "overlay")
        && webview.url().is_ok_and(|url| trusted_origin(&url));
    if trusted
        && webview
            .state::<MicrophoneConsent>()
            .granted
            .load(Ordering::SeqCst)
    {
        PermissionResponse::Allow
    } else {
        PermissionResponse::Deny
    }
}

#[tauri::command]
pub async fn request_microphone_consent(
    window: WebviewWindow,
    consent: State<'_, MicrophoneConsent>,
) -> Result<bool, String> {
    if !matches!(window.label(), "main" | "overlay")
        || !window.url().is_ok_and(|url| trusted_origin(&url))
    {
        return Err("Microphone requests must come from Alfred.".into());
    }
    let consent = consent.inner().clone();
    let parent = window
        .hwnd()
        .map_err(|_| "Could not open the permission prompt.")?
        .0 as usize;
    // Ask before getUserMedia, outside WebView2's COM permission callback. A
    // blocking modal dialog inside that callback can cause reentrancy failures.
    tauri::async_runtime::spawn_blocking(move || -> Result<bool, String> {
        let _guard = consent
            .prompt
            .lock()
            .map_err(|_| "Could not open the permission prompt.")?;
        if consent.granted.load(Ordering::SeqCst) {
            return Ok(true);
        }
        let title: Vec<u16> = "Alfred\0".encode_utf16().collect();
        let message: Vec<u16> = "Allow Alfred to use your microphone for voice input?\0"
            .encode_utf16()
            .collect();
        // The owning window remains responsive while this worker shows the dialog.
        let allowed = unsafe {
            MessageBoxW(
                parent as _,
                message.as_ptr(),
                title.as_ptr(),
                MB_YESNO | MB_ICONQUESTION | MB_DEFBUTTON2,
            )
        } == IDYES;
        consent.granted.store(allowed, Ordering::SeqCst);
        Ok(allowed)
    })
    .await
    .map_err(|_| "Could not open the permission prompt.")?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_exact_local_app_origins_are_trusted() {
        for url in [
            "http://tauri.localhost",
            "https://tauri.localhost/index.html?window=overlay",
        ] {
            assert!(trusted_origin(&tauri::Url::parse(url).unwrap()));
        }
        for url in [
            "https://example.com",
            "https://tauri.localhost.example.com",
            "https://tauri.localhost:8443",
            "https://user@tauri.localhost",
        ] {
            assert!(!trusted_origin(&tauri::Url::parse(url).unwrap()));
        }
        assert_eq!(
            trusted_origin(&tauri::Url::parse("http://localhost:5173").unwrap()),
            cfg!(debug_assertions)
        );
    }
}
