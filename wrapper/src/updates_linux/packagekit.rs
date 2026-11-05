use futures_util::StreamExt;
use std::{path::Path, time::Duration};
use zbus::{Connection, Proxy, proxy::MethodFlags, zvariant::OwnedObjectPath};

const SERVICE: &str = "org.freedesktop.PackageKit";
const TRANSACTION: &str = "org.freedesktop.PackageKit.Transaction";

#[derive(Debug)]
pub(super) struct InstallError {
    pub message: String,
    pub uncertain: bool,
}
impl From<String> for InstallError {
    fn from(message: String) -> Self {
        Self {
            message,
            uncertain: true,
        }
    }
}

pub(super) async fn connect() -> Result<Connection, String> {
    let connection = Connection::system()
        .await
        .map_err(|_| "Could not connect to Fedora’s package installer.")?;
    let service = Proxy::new(&connection, SERVICE, "/org/freedesktop/PackageKit", SERVICE)
        .await
        .map_err(|_| "PackageKit is unavailable. Install the RPM with your package manager.")?;
    service
        .get_property::<u32>("VersionMajor")
        .await
        .map_err(|_| "PackageKit is unavailable. Install it or use dnf to update Alfred.")?;
    Ok(connection)
}

pub(super) async fn install(connection: Connection, file: &Path) -> Result<(), InstallError> {
    let service = Proxy::new(&connection, SERVICE, "/org/freedesktop/PackageKit", SERVICE)
        .await
        .map_err(|e| e.to_string())?;
    let path: OwnedObjectPath = service
        .call("CreateTransaction", &())
        .await
        .map_err(|e| e.to_string())?;
    let transaction = Proxy::new(&connection, SERVICE, path, TRANSACTION)
        .await
        .map_err(|e| e.to_string())?;
    let mut signals = transaction
        .receive_all_signals()
        .await
        .map_err(|e| e.to_string())?;
    transaction
        .call::<_, _, ()>("SetHints", &(vec!["interactive=true", "background=false"],))
        .await
        .map_err(|e| e.to_string())?;
    // The RPM has already passed Alfred's pinned-key verification. Fedora's
    // native authorization still controls installation, including unsigned RPMs.
    transaction
        .call_with_flags::<_, _, ()>(
            "InstallFiles",
            MethodFlags::AllowInteractiveAuth.into(),
            &(
                0_u64,
                vec![
                    file.to_str()
                        .ok_or_else(|| "Invalid RPM path".to_string())?,
                ],
            ),
        )
        .await
        .map_err(|_| {
            "Fedora could not start this update. Authorization may have been cancelled.".to_string()
        })?;
    let result = tokio::time::timeout(Duration::from_secs(30 * 60), async {
        let mut error = None;
        while let Some(message) = signals.next().await {
            match message.header().member().map(|value| value.as_str()) {
                Some("ErrorCode") => {
                    error = Some(match message.body().deserialize::<(u32, String)>() {
                        Ok((_code, details)) => details,
                        Err(_) => "Fedora returned an invalid installation error.".into(),
                    });
                }
                Some("Finished") => {
                    let (exit, _runtime): (u32, u32) = message.body().deserialize().map_err(|_| "Fedora returned an invalid install result.".to_string())?;
                    return finish(exit, error).map_err(|message| InstallError { message, uncertain: false });
                }
                _ => {}
            }
        }
        Err(InstallError { uncertain: true, message: "Lost the connection to Fedora’s installer. Check your software manager before trying again.".into() })
    }).await;
    match result {
        Ok(result) => result,
        Err(_) => Err(InstallError { uncertain: true, message: "Timed out waiting for Fedora’s installer. Check your software manager before trying again.".into() }),
    }
}

fn finish(exit: u32, error: Option<String>) -> Result<(), String> {
    if exit == 1 && error.is_none() {
        Ok(())
    } else if exit == 3 {
        Err("The update was cancelled. You can try again when ready.".into())
    } else {
        Err(error.unwrap_or_else(|| {
            "Fedora could not install the update. Check your software manager and try again.".into()
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_a_successful_completed_transaction_can_restart_the_app() {
        assert!(finish(1, None).is_ok());
        assert!(finish(1, Some("Failure".into())).is_err());
        assert!(finish(2, None).is_err());
        assert!(finish(3, None).unwrap_err().contains("cancelled"));
        assert!(finish(7, None).is_err());
    }

    struct Factory;
    #[zbus::interface(name = "org.freedesktop.PackageKit")]
    impl Factory {
        fn create_transaction(&self) -> OwnedObjectPath {
            OwnedObjectPath::try_from("/org/freedesktop/PackageKit/transactions/fixture").unwrap()
        }
    }

    struct Transaction {
        exit: std::sync::Arc<std::sync::atomic::AtomicU32>,
        requests: std::sync::Arc<std::sync::Mutex<Vec<Vec<String>>>>,
    }
    #[zbus::interface(name = "org.freedesktop.PackageKit.Transaction")]
    impl Transaction {
        fn set_hints(&self, hints: Vec<String>) {
            assert!(hints.contains(&"interactive=true".into()));
        }
        async fn install_files(
            &self,
            flags: u64,
            files: Vec<String>,
            #[zbus(signal_emitter)] emitter: zbus::object_server::SignalEmitter<'_>,
        ) -> zbus::fdo::Result<()> {
            assert_eq!(flags, 0);
            self.requests.lock().unwrap().push(files);
            let exit = self.exit.load(std::sync::atomic::Ordering::SeqCst);
            if exit == 2 {
                Self::error_code(&emitter, 7, "Fixture installation failure")
                    .await
                    .map_err(|error| zbus::fdo::Error::Failed(error.to_string()))?;
            }
            // Emit before replying to exercise subscription ordering too.
            Self::finished(&emitter, exit, 1)
                .await
                .map_err(|error| zbus::fdo::Error::Failed(error.to_string()))?;
            Ok(())
        }
        #[zbus(signal)]
        async fn error_code(
            emitter: &zbus::object_server::SignalEmitter<'_>,
            code: u32,
            details: &str,
        ) -> zbus::Result<()>;
        #[zbus(signal)]
        async fn finished(
            emitter: &zbus::object_server::SignalEmitter<'_>,
            exit: u32,
            runtime: u32,
        ) -> zbus::Result<()>;
    }

    #[tokio::test]
    #[ignore = "run inside dbus-run-session; never contacts the real system installer"]
    async fn private_bus_install_waits_for_success_and_reports_cancel_and_failure() {
        let exit = std::sync::Arc::new(std::sync::atomic::AtomicU32::new(1));
        let requests = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
        let _server = zbus::connection::Builder::session()
            .unwrap()
            .name(SERVICE)
            .unwrap()
            .serve_at("/org/freedesktop/PackageKit", Factory)
            .unwrap()
            .serve_at(
                "/org/freedesktop/PackageKit/transactions/fixture",
                Transaction {
                    exit: exit.clone(),
                    requests: requests.clone(),
                },
            )
            .unwrap()
            .build()
            .await
            .unwrap();
        for code in [1, 3, 2] {
            exit.store(code, std::sync::atomic::Ordering::SeqCst);
            let result = install(
                Connection::session().await.unwrap(),
                Path::new("/tmp/verified-fixture.rpm"),
            )
            .await;
            if code == 1 {
                assert!(result.is_ok(), "{result:?}");
            } else {
                let error = result.unwrap_err();
                assert!(!error.uncertain);
                assert!(error.message.contains(if code == 3 {
                    "cancelled"
                } else {
                    "Fixture installation failure"
                }));
            }
        }
        assert_eq!(
            requests.lock().unwrap().as_slice(),
            &vec![vec!["/tmp/verified-fixture.rpm".to_string()]; 3]
        );
    }
}
