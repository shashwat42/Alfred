use base64::{Engine, engine::general_purpose::STANDARD};
use minisign_verify::{PublicKey, Signature};
use semver::Version;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{collections::HashMap, path::Path, time::Duration};
use tauri::{AppHandle, Manager, State, WebviewWindow, ipc::Channel};

#[path = "updates_linux/packagekit.rs"]
mod packagekit;

const DOWNLOAD_PREFIX: &str = "https://github.com/shashwat42/Alfred/releases/download/";
const RELEASES: &str = "https://api.github.com/repos/shashwat42/Alfred/releases";
const MAX_RPM: usize = 128 * 1024 * 1024;

#[derive(Default)]
pub struct UpdateState(tauri::async_runtime::Mutex<Option<Candidate>>);

#[derive(Clone, Debug, Deserialize)]
struct Asset {
    name: String,
    browser_download_url: String,
}
#[derive(Clone, Debug, Deserialize)]
struct Release {
    tag_name: String,
    draft: bool,
    assets: Vec<Asset>,
}
#[derive(Debug, Deserialize)]
struct Manifest {
    version: String,
    notes: Option<String>,
    platforms: HashMap<String, Package>,
}
#[derive(Clone, Debug, Deserialize)]
struct Package {
    url: String,
    signature: String,
    sha256: String,
    size: u64,
}
#[derive(Clone, Debug)]
struct Candidate {
    version: Version,
    package: Package,
    architecture: String,
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

fn authorize(window: &WebviewWindow) -> Result<(), String> {
    if window.label() == "main"
        && window
            .url()
            .is_ok_and(|url| crate::origin::trusted_origin(&url))
    {
        Ok(())
    } else {
        Err("Updates are available only in the main Alfred window.".into())
    }
}

fn architecture() -> Result<&'static str, String> {
    match std::env::consts::ARCH {
        "x86_64" => Ok("x86_64"),
        "aarch64" => Ok("aarch64"),
        _ => Err("Published RPM updates are not available for this architecture.".into()),
    }
}

fn rpm_name(version: &Version, architecture: &str) -> String {
    format!("Alfred-{version}-1.{architecture}.rpm")
}

fn select(
    releases: &[Release],
    current: &Version,
    architecture: &str,
) -> Option<(Version, Release)> {
    releases
        .iter()
        // 1.0.31 was published before 1.0.4 despite its higher patch number.
        .filter(|release| !release.draft && release.tag_name != "v1.0.31")
        .filter_map(|release| {
            let version = Version::parse(release.tag_name.strip_prefix('v')?).ok()?;
            if version <= *current || release.tag_name != format!("v{version}") {
                return None;
            }
            let manifest = release
                .assets
                .iter()
                .find(|asset| asset.name == "linux-update.json")?;
            if manifest.browser_download_url
                != format!("{DOWNLOAD_PREFIX}{}/linux-update.json", release.tag_name)
            {
                return None;
            }
            let name = rpm_name(&version, architecture);
            if !release.assets.iter().any(|asset| {
                asset.name == name
                    && asset.browser_download_url
                        == format!("{DOWNLOAD_PREFIX}{}/{name}", release.tag_name)
            }) {
                return None;
            }
            Some((version, release.clone()))
        })
        .max_by(|a, b| a.0.cmp(&b.0))
}

fn validate_manifest(
    manifest: Manifest,
    release: &Release,
    version: &Version,
    architecture: &str,
) -> Result<(Candidate, Option<String>), String> {
    if Version::parse(&manifest.version).ok().as_ref() != Some(version) {
        return Err("The Linux update version does not match its release.".into());
    }
    let package = manifest
        .platforms
        .get(&format!("linux-{architecture}"))
        .ok_or("This release has no RPM for your architecture.")?
        .clone();
    let name = rpm_name(version, architecture);
    let expected = format!("{DOWNLOAD_PREFIX}{}/{name}", release.tag_name);
    if package.url != expected
        || !release
            .assets
            .iter()
            .any(|asset| asset.name == name && asset.browser_download_url == expected)
    {
        return Err("The RPM does not belong to this release and architecture.".into());
    }
    if package.size == 0
        || package.size > MAX_RPM as u64
        || package.sha256.len() != 64
        || !package
            .sha256
            .bytes()
            .all(|value| value.is_ascii_hexdigit())
        || package.signature.len() > 4096
        || package.signature.is_empty()
    {
        return Err("The Linux update metadata is invalid.".into());
    }
    Ok((
        Candidate {
            version: version.clone(),
            package,
            architecture: architecture.into(),
        },
        manifest.notes,
    ))
}

fn client() -> Result<reqwest::Client, String> {
    let _ = rustls::crypto::ring::default_provider().install_default();
    reqwest::Client::builder()
        .user_agent(concat!("Alfred/", env!("CARGO_PKG_VERSION")))
        .timeout(Duration::from_secs(15 * 60))
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            let url = attempt.url();
            let trusted = url.host_str().is_some_and(|host| {
                matches!(host, "github.com" | "api.github.com")
                    || host.ends_with(".githubusercontent.com")
            });
            if attempt.previous().len() < 5 && url.scheme() == "https" && trusted {
                attempt.follow()
            } else {
                attempt.error("Untrusted update redirect")
            }
        }))
        .build()
        .map_err(|_| "Could not start the Linux update check.".into())
}

async fn read_limited(
    mut response: reqwest::Response,
    limit: usize,
    progress: Option<&Channel<Progress>>,
) -> Result<Vec<u8>, String> {
    if response.status() == reqwest::StatusCode::FORBIDDEN
        || response.status() == reqwest::StatusCode::TOO_MANY_REQUESTS
    {
        return Err("GitHub’s update request limit was reached. Try again later.".into());
    }
    response
        .error_for_status_ref()
        .map_err(|_| "GitHub could not provide this update. Try again later.")?;
    let total = response.content_length();
    if total.is_some_and(|size| size > limit as u64) {
        return Err("The update response is too large.".into());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "The update download was interrupted. Try again.")?
    {
        if bytes.len() + chunk.len() > limit {
            return Err("The update response is too large.".into());
        }
        bytes.extend_from_slice(&chunk);
        if let Some(progress) = progress {
            let _ = progress.send(Progress::Downloading {
                downloaded: bytes.len() as u64,
                total,
            });
        }
    }
    Ok(bytes)
}

fn verify_bytes(candidate: &Candidate, bytes: &[u8], encoded_key: &str) -> Result<(), String> {
    if bytes.len() as u64 != candidate.package.size
        || format!("{:x}", Sha256::digest(bytes)) != candidate.package.sha256.to_lowercase()
    {
        return Err("The downloaded RPM failed its size or checksum check. Please retry.".into());
    }
    let decode = |value: &str| {
        STANDARD
            .decode(value.trim())
            .ok()
            .and_then(|bytes| String::from_utf8(bytes).ok())
    };
    let key = decode(encoded_key)
        .and_then(|value| PublicKey::decode(&value).ok())
        .ok_or("The updater verification key is invalid.")?;
    let signature = decode(&candidate.package.signature)
        .and_then(|value| Signature::decode(&value).ok())
        .ok_or("The RPM update signature is invalid.")?;
    key.verify(bytes, &signature, false).map_err(|_| "The RPM signature does not match Alfred’s trusted signing key. Installation was stopped.".to_string())?;
    let signed_version = signature
        .trusted_comment()
        .split('\t')
        .find_map(|field| field.strip_prefix("version:"));
    if signed_version != Some(candidate.version.to_string().as_str()) {
        return Err("The RPM signature does not authorize this release version.".into());
    }
    Ok(())
}

async fn rpm_query(args: &[&str]) -> Result<String, String> {
    let output = tokio::time::timeout(
        Duration::from_secs(20),
        tokio::process::Command::new("/usr/bin/rpm")
            .args(args)
            .kill_on_drop(true)
            .output(),
    )
    .await
    .map_err(|_| "The RPM database did not respond. Try again later.")?
    .map_err(|_| "Linux in-app updates require an RPM installation and the rpm command.")?;
    if !output.status.success() {
        return Err("Run Alfred from its installed RPM to use in-app updates. Restart it if another installer already updated it.".into());
    }
    String::from_utf8(output.stdout).map_err(|_| "Invalid RPM package information.".into())
}

fn validate_header(output: &str, version: &Version, architecture: &str) -> Result<(), String> {
    let fields: Vec<_> = output.lines().collect();
    if fields != ["alfred", version.to_string().as_str(), architecture] {
        return Err(
            "The signed RPM package name, version or architecture does not match this update."
                .into(),
        );
    }
    Ok(())
}

#[tauri::command]
pub async fn check_for_app_update(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, UpdateState>,
) -> Result<Option<AvailableUpdate>, String> {
    authorize(&window)?;
    let mut pending = state
        .0
        .try_lock()
        .map_err(|_| "An update operation is already in progress.")?;
    let client = client()?;
    let current = app.package_info().version.clone();
    let mut candidate: Option<(Version, Release)> = None;
    for page in 1..=20 {
        let response = client
            .get(format!("{RELEASES}?per_page=100&page={page}"))
            .timeout(Duration::from_secs(30))
            .send()
            .await
            .map_err(|_| "Could not reach GitHub. Check your connection and try again.")?;
        let releases: Vec<Release> =
            serde_json::from_slice(&read_limited(response, 4 * 1024 * 1024, None).await?)
                .map_err(|_| "GitHub returned invalid release information.")?;
        if let Some(found) = select(&releases, &current, architecture()?) {
            if candidate.as_ref().is_none_or(|value| found.0 > value.0) {
                candidate = Some(found);
            }
        }
        if releases.len() < 100 {
            break;
        }
        if page == 20 {
            return Err("Too many releases to complete the update check. Try again later.".into());
        }
    }
    let Some((version, release)) = candidate else {
        *pending = None;
        return Ok(None);
    };
    let url = format!("{DOWNLOAD_PREFIX}{}/linux-update.json", release.tag_name);
    let response = client
        .get(url)
        .timeout(Duration::from_secs(30))
        .send()
        .await
        .map_err(|_| "Could not download Linux update information.")?;
    let manifest = serde_json::from_slice(&read_limited(response, 64 * 1024, None).await?)
        .map_err(|_| "The Linux update manifest is invalid.")?;
    let (candidate, notes) = validate_manifest(manifest, &release, &version, architecture()?)?;
    let info = AvailableUpdate {
        version: version.to_string(),
        notes,
    };
    *pending = Some(candidate);
    Ok(Some(info))
}

#[tauri::command]
pub async fn install_app_update(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, UpdateState>,
    version: String,
    on_progress: Channel<Progress>,
) -> Result<(), String> {
    authorize(&window)?;
    let pending = state
        .0
        .try_lock()
        .map_err(|_| "An update operation is already in progress.")?;
    let candidate = pending
        .as_ref()
        .ok_or("Check for updates before installing.")?;
    if candidate.version.to_string() != version || candidate.version <= app.package_info().version {
        return Err("The available update changed. Check for updates again.".into());
    }
    let executable = std::env::current_exe().map_err(|e| e.to_string())?;
    let installed = rpm_query(&[
        "-qf",
        executable.to_str().ok_or("Invalid executable path")?,
        "--queryformat",
        "%{NAME}\n%{VERSION}\n%{ARCH}\n",
    ])
    .await?;
    let installed_fields: Vec<_> = installed.lines().collect();
    if installed_fields.len() != 3
        || installed_fields[0] != "alfred"
        || installed_fields[2] != candidate.architecture
    {
        return Err("Use the installed Alfred RPM to update this app.".into());
    }
    let installed_version =
        Version::parse(installed_fields[1]).map_err(|_| "The installed RPM version is invalid.")?;
    if candidate.version <= installed_version {
        return Err("This version or a newer RPM is already installed. Restart Alfred.".into());
    }
    // Check the system service before spending bandwidth; this does not install
    // anything or ask for elevated permissions until the verified file is ready.
    let connection = packagekit::connect().await?;
    let response = client()?
        .get(&candidate.package.url)
        .send()
        .await
        .map_err(|_| "The RPM could not be downloaded. Try again.")?;
    let bytes = read_limited(
        response,
        candidate.package.size as usize,
        Some(&on_progress),
    )
    .await?;
    let key = app
        .config()
        .plugins
        .0
        .get("updater")
        .and_then(|value| value.get("pubkey"))
        .and_then(|value| value.as_str())
        .ok_or("The updater verification key is missing.")?;
    verify_bytes(candidate, &bytes, key)?;
    let cache = app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("updates");
    tokio::fs::create_dir_all(&cache)
        .await
        .map_err(|e| e.to_string())?;
    let directory = tempfile::Builder::new()
        .prefix("rpm-")
        .tempdir_in(&cache)
        .map_err(|e| e.to_string())?;
    let path = directory
        .path()
        .join(rpm_name(&candidate.version, &candidate.architecture));
    tokio::fs::write(&path, &bytes)
        .await
        .map_err(|e| e.to_string())?;
    drop(bytes);
    let path_text = path.to_str().ok_or("Invalid update path")?;
    validate_header(
        &rpm_query(&[
            "-qp",
            path_text,
            "--queryformat",
            "%{NAME}\n%{VERSION}\n%{ARCH}\n",
        ])
        .await?,
        &candidate.version,
        &candidate.architecture,
    )?;
    let _ = on_progress.send(Progress::Installing);
    if let Err(error) = packagekit::install(connection, Path::new(path_text)).await {
        // If the daemon timed out it may still be reading the file. Keep its
        // private staging directory; never remove a live transaction's payload.
        if error.uncertain {
            let _ = directory.keep();
        }
        return Err(error.message);
    }
    drop(directory);
    app.restart();
}

#[cfg(test)]
mod tests {
    use super::*;
    fn release(version: &str) -> Release {
        let tag = format!("v{version}");
        Release {
            tag_name: tag.clone(),
            draft: false,
            assets: [
                "linux-update.json".to_string(),
                format!("Alfred-{version}-1.x86_64.rpm"),
            ]
            .into_iter()
            .map(|name| Asset {
                browser_download_url: format!("{DOWNLOAD_PREFIX}{tag}/{name}"),
                name,
            })
            .collect(),
        }
    }
    fn manifest(version: &str) -> Manifest {
        Manifest {
            version: version.into(),
            notes: None,
            platforms: HashMap::from([(
                "linux-x86_64".into(),
                Package {
                    url: format!("{DOWNLOAD_PREFIX}v{version}/Alfred-{version}-1.x86_64.rpm"),
                    signature: "fixture".into(),
                    sha256: "0".repeat(64),
                    size: 10,
                },
            )]),
        }
    }
    #[test]
    fn github_client_has_a_working_tls_provider() {
        assert!(client().is_ok());
    }

    #[test]
    fn selects_only_newer_published_linux_releases() {
        let current = Version::parse("1.0.2").unwrap();
        let mut draft = release("9.0.0");
        draft.draft = true;
        let mut external = release("8.0.0");
        external.assets[0].browser_download_url = "https://evil.example/linux-update.json".into();
        assert_eq!(
            select(
                &[release("1.0.1"), release("1.0.3"), draft, external],
                &current,
                "x86_64"
            )
            .unwrap()
            .0
            .to_string(),
            "1.0.3"
        );
        assert!(select(&[release("1.0.2")], &current, "x86_64").is_none());
        let mut arm = release("2.0.0");
        arm.assets[1].name = arm.assets[1].name.replace("x86_64", "aarch64");
        arm.assets[1].browser_download_url = arm.assets[1]
            .browser_download_url
            .replace("x86_64", "aarch64");
        assert_eq!(
            select(&[release("1.0.3"), arm], &current, "x86_64")
                .unwrap()
                .0
                .to_string(),
            "1.0.3"
        );
    }
    #[test]
    fn skips_the_older_1_0_31_build() {
        let current = Version::parse("1.0.4").unwrap();
        let releases = [release("1.0.31"), release("1.0.5")];
        assert_eq!(select(&releases, &current, "x86_64").unwrap().0.to_string(), "1.0.5");
    }
    #[test]
    fn rejects_wrong_versions_architectures_urls_and_oversized_packages() {
        let version = Version::parse("1.0.3").unwrap();
        let release = release("1.0.3");
        assert!(validate_manifest(manifest("1.0.3"), &release, &version, "x86_64").is_ok());
        assert!(validate_manifest(manifest("1.0.4"), &release, &version, "x86_64").is_err());
        assert!(validate_manifest(manifest("1.0.3"), &release, &version, "aarch64").is_err());
        let mut value = manifest("1.0.3");
        value
            .platforms
            .get_mut("linux-x86_64")
            .unwrap()
            .url
            .push_str("?redirect=evil");
        assert!(validate_manifest(value, &release, &version, "x86_64").is_err());
        let mut value = manifest("1.0.3");
        value.platforms.get_mut("linux-x86_64").unwrap().size = MAX_RPM as u64 + 1;
        assert!(validate_manifest(value, &release, &version, "x86_64").is_err());
    }
    #[test]
    fn rejects_tampered_bytes_and_mismatched_rpm_headers() {
        let candidate = validate_manifest(
            manifest("1.0.3"),
            &release("1.0.3"),
            &Version::parse("1.0.3").unwrap(),
            "x86_64",
        )
        .unwrap()
        .0;
        assert!(verify_bytes(&candidate, b"tampered", "invalid").is_err());
        assert!(validate_header("alfred\n1.0.3\nx86_64\n", &candidate.version, "x86_64").is_ok());
        for value in [
            "other\n1.0.3\nx86_64\n",
            "alfred\n1.0.1\nx86_64\n",
            "alfred\n1.0.3\naarch64\n",
        ] {
            assert!(validate_header(value, &candidate.version, "x86_64").is_err());
        }
    }

    #[test]
    fn verifies_signed_bytes_and_binds_the_authorized_version() {
        // Public fixture generated with a throwaway signing key. No private
        // signing material is included in the source tree.
        let fixture: serde_json::Value = serde_json::from_str(include_str!(
            "../tests/fixtures/linux-update-signature.json"
        ))
        .unwrap();
        let bytes = fixture["payload"].as_str().unwrap().as_bytes();
        let mut candidate = validate_manifest(
            manifest("1.0.3"),
            &release("1.0.3"),
            &Version::parse("1.0.3").unwrap(),
            "x86_64",
        )
        .unwrap()
        .0;
        candidate.package.size = bytes.len() as u64;
        candidate.package.sha256 = format!("{:x}", Sha256::digest(bytes));
        candidate.package.signature = fixture["signature"].as_str().unwrap().into();
        let key = fixture["publicKey"].as_str().unwrap();
        assert!(verify_bytes(&candidate, bytes, key).is_ok());
        candidate.version = Version::parse("1.0.4").unwrap();
        assert!(
            verify_bytes(&candidate, bytes, key)
                .unwrap_err()
                .contains("release version")
        );
        candidate.version = Version::parse("1.0.3").unwrap();
        candidate.package.sha256 = format!("{:x}", Sha256::digest(b"evil"));
        assert!(
            verify_bytes(&candidate, b"evil", key)
                .unwrap_err()
                .contains("signature")
        );
    }
}
