use semver::Version;
use serde::{Deserialize, Serialize};
use std::time::Duration;
use tauri::{AppHandle, State, WebviewWindow, ipc::Channel};
use tauri_plugin_updater::{Update, UpdaterExt};

const RELEASES: &str = "https://api.github.com/repos/shashwat42/Alfred/releases";
const DOWNLOAD_PREFIX: &str = "https://github.com/shashwat42/Alfred/releases/download/";

fn release_client() -> Result<reqwest::Client, reqwest::Error> {
    let _ = rustls::crypto::ring::default_provider().install_default();
    reqwest::Client::builder()
        .user_agent(concat!("Alfred/", env!("CARGO_PKG_VERSION")))
        .timeout(Duration::from_secs(20))
        .build()
}

#[derive(Default)]
pub struct UpdateState(tauri::async_runtime::Mutex<Option<Update>>);

#[derive(Deserialize)]
struct Release {
    tag_name: String,
    draft: bool,
    assets: Vec<Asset>,
}
#[derive(Deserialize)]
struct Asset {
    name: String,
    browser_download_url: String,
}
#[derive(Serialize)]
pub struct AvailableUpdate {
    version: String,
    notes: Option<String>,
}
#[derive(Clone, Serialize)]
#[serde(tag = "event", rename_all = "camelCase")]
pub enum Progress {
    Downloading { downloaded: u64, total: Option<u64> },
    Installing,
}

fn main_window(window: &WebviewWindow) -> Result<(), String> {
    if window.label() == "main"
        && window
            .url()
            .is_ok_and(|url| crate::permissions::trusted_origin(&url))
    {
        Ok(())
    } else {
        Err("Updates are available only in the main Alfred window.".into())
    }
}

fn newest(releases: &[Release], current: &Version) -> Option<(Version, String)> {
    releases
        .iter()
        .filter(|release| !release.draft)
        .filter_map(|release| {
            let version = Version::parse(release.tag_name.trim_start_matches('v')).ok()?;
            if version <= *current {
                return None;
            }
            let asset = release
                .assets
                .iter()
                .find(|asset| asset.name == "latest.json")?;
            let expected = format!("{DOWNLOAD_PREFIX}{}/latest.json", release.tag_name);
            if asset.browser_download_url != expected {
                return None;
            }
            Some((version, asset.browser_download_url.clone()))
        })
        .max_by(|a, b| a.0.cmp(&b.0))
}

#[tauri::command]
pub async fn check_for_app_update(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, UpdateState>,
) -> Result<Option<AvailableUpdate>, String> {
    main_window(&window)?;
    let mut pending = state
        .0
        .try_lock()
        .map_err(|_| "An update operation is already in progress.")?;
    let client = release_client()
        .map_err(|_| "Could not start the update check.")?;
    // GitHub's stable-only /releases/latest endpoint omits beta releases.
    let mut page = 1;
    let mut candidate: Option<(Version, String)> = None;
    let current = app.package_info().version.clone();
    loop {
        let response = client
            .get(format!("{RELEASES}?per_page=100&page={page}"))
            .send()
            .await
            .map_err(|_| "Could not reach GitHub. Check your connection and try again.")?;
        if response.status() == reqwest::StatusCode::FORBIDDEN
            || response.status() == reqwest::StatusCode::TOO_MANY_REQUESTS
        {
            return Err("GitHub's update check limit was reached. Please try again later.".into());
        }
        let releases: Vec<Release> = response
            .error_for_status()
            .map_err(|_| "GitHub could not provide update information. Try again later.")?
            .json()
            .await
            .map_err(|_| "GitHub returned invalid update information.")?;
        if let Some(found) = newest(&releases, &current) {
            if candidate.as_ref().is_none_or(|value| found.0 > value.0) {
                candidate = Some(found);
            }
        }
        if releases.len() < 100 {
            break;
        }
        page += 1;
    }
    let Some((version, endpoint)) = candidate else {
        *pending = None;
        return Ok(None);
    };
    let mut update = app
        .updater_builder()
        .endpoints(vec![
            endpoint.parse().map_err(|_| "Invalid update address.")?,
        ])
        .map_err(|_| "Invalid update endpoint configuration.")?
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|_| "Updates are not configured for this installation.")?
        .check()
        .await
        .map_err(|_| "Could not load the update package. Please try again.")?
        .ok_or("The release does not contain a newer update package.")?;
    if Version::parse(&update.version).ok().as_ref() != Some(&version)
        || !update.download_url.as_str().starts_with(DOWNLOAD_PREFIX)
        || !update.download_url.path().ends_with("-setup.exe")
    {
        return Err("The update package does not match the published release.".into());
    }
    update.timeout = Some(Duration::from_secs(15 * 60));
    let info = AvailableUpdate {
        version: update.version.clone(),
        notes: update.body.clone(),
    };
    *pending = Some(update);
    Ok(Some(info))
}

#[tauri::command]
pub async fn install_app_update(
    window: WebviewWindow,
    state: State<'_, UpdateState>,
    version: String,
    on_progress: Channel<Progress>,
) -> Result<(), String> {
    main_window(&window)?;
    let mut pending = state
        .0
        .try_lock()
        .map_err(|_| "An update operation is already in progress.")?;
    let update = pending
        .as_ref()
        .ok_or("Check for updates before installing.")?;
    if update.version != version {
        return Err("The available update changed. Check for updates again.".into());
    }
    let mut downloaded = 0_u64;
    // Tauri verifies the pinned-key signature before starting the installer.
    let bytes = update.download(|length, total| {
        downloaded += length as u64;
        let _ = on_progress.send(Progress::Downloading { downloaded, total });
    }, || {}).await.map_err(|_| "The update could not be downloaded or verified. Your current installation is unchanged; please retry.")?;
    let _ = on_progress.send(Progress::Installing);
    update
        .clone()
        .restart_after_install(true)
        .install(bytes)
        .map_err(|_| "The update installer could not start. Please try again.")?;
    *pending = None;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn release(tag: &str, draft: bool) -> Release {
        Release {
            tag_name: tag.into(),
            draft,
            assets: vec![Asset {
                name: "latest.json".into(),
                browser_download_url: format!("{DOWNLOAD_PREFIX}{tag}/latest.json"),
            }],
        }
    }
    #[test]
    fn chooses_highest_semver_including_betas_without_downgrades() {
        let current = Version::parse("0.1.0-beta.2").unwrap();
        let releases = vec![
            release("v0.1.0-beta.9", false),
            release("v0.1.0-beta.10", false),
            release("v9.0.0", true),
            release("invalid", false),
        ];
        assert_eq!(
            newest(&releases, &current).unwrap().0.to_string(),
            "0.1.0-beta.10"
        );
        assert!(newest(&releases, &Version::parse("1.0.0").unwrap()).is_none());
        assert!(newest(&[release("v0.1.0-beta.2", false)], &current).is_none());
        assert_eq!(
            newest(&[release("v0.1.0", false)], &current)
                .unwrap()
                .0
                .to_string(),
            "0.1.0"
        );
    }
    #[test]
    fn ignores_drafts_missing_manifests_and_external_asset_urls() {
        let mut missing = release("v2.0.0", false);
        missing.assets.clear();
        let mut external = release("v3.0.0", false);
        external.assets[0].browser_download_url = "https://example.com/latest.json".into();
        assert!(
            newest(
                &[missing, external, release("v4.0.0", true)],
                &Version::parse("0.1.0").unwrap()
            )
            .is_none()
        );
    }
    #[test]
    fn github_client_has_a_working_tls_provider() {
        assert!(release_client().is_ok());
    }
}
