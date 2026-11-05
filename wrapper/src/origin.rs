pub(crate) fn trusted_origin(url: &tauri::Url) -> bool {
    if !url.username().is_empty() || url.password().is_some() {
        return false;
    }
    match (url.scheme(), url.host_str(), url.port()) {
        ("http" | "https", Some("tauri.localhost"), None) => true,
        ("tauri", Some("localhost"), None) => true,
        ("http", Some("localhost" | "127.0.0.1"), Some(5173)) => cfg!(debug_assertions),
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn trusts_only_exact_packaged_origins() {
        for value in ["tauri://localhost", "http://tauri.localhost", "https://tauri.localhost"] {
            assert!(trusted_origin(&tauri::Url::parse(value).unwrap()));
        }
        for value in ["tauri://evil", "tauri://localhost:8000", "tauri://user@localhost", "https://tauri.localhost.evil", "https://example.com"] {
            assert!(!trusted_origin(&tauri::Url::parse(value).unwrap()));
        }
    }
}
