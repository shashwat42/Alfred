use std::{fs, path::{Path, PathBuf}, sync::Mutex};
use tauri::WebviewWindow;

static STARTUP_WRITE: Mutex<()> = Mutex::new(());

fn authorize(window: &WebviewWindow) -> Result<(), String> {
    if window.label() != "main" || !window.url().is_ok_and(|url| crate::origin::trusted_origin(&url)) {
        return Err("Startup settings must come from Alfred settings.".into());
    }
    Ok(())
}

fn startup_path() -> Result<PathBuf, String> {
    let config = std::env::var_os("XDG_CONFIG_HOME").map(PathBuf::from)
        .filter(|path| path.is_absolute())
        .or_else(|| std::env::var_os("HOME").map(PathBuf::from)
            .filter(|path| path.is_absolute()).map(|path| path.join(".config")))
        .ok_or("Could not locate your desktop configuration directory.")?;
    Ok(config.join("autostart/com.alfred.app.desktop"))
}

fn entry(executable: &Path) -> Result<String, String> {
    let executable = executable.to_str().ok_or("The Alfred executable path must be UTF-8.")?;
    if executable.contains(['\n', '\r', '\0']) { return Err("Invalid executable path.".into()); }
    // Desktop Entry Exec quoting, followed by string-value backslash escaping.
    let mut quoted = String::new();
    for ch in executable.chars() {
        match ch {
            '%' => quoted.push_str("%%"),
            '\\' | '"' | '`' | '$' => { quoted.push('\\'); quoted.push(ch); }
            _ => quoted.push(ch),
        }
    }
    let quoted = quoted.replace('\\', "\\\\");
    Ok(format!("[Desktop Entry]\nType=Application\nName=Alfred\nExec=\"{quoted}\"\nTerminal=false\nX-GNOME-Autostart-enabled=true\n"))
}

#[tauri::command]
pub fn get_launch_on_startup(window: WebviewWindow) -> Result<bool, String> {
    authorize(&window)?;
    let path = startup_path()?;
    match fs::read_to_string(path) {
        Ok(value) => Ok(value == entry(&std::env::current_exe().map_err(|e| e.to_string())?)?),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
pub fn set_launch_on_startup(window: WebviewWindow, enabled: bool) -> Result<bool, String> {
    authorize(&window)?;
    let _guard = STARTUP_WRITE.lock().map_err(|e| e.to_string())?;
    let path = startup_path()?;
    if enabled {
        let contents = entry(&std::env::current_exe().map_err(|e| e.to_string())?)?;
        fs::create_dir_all(path.parent().ok_or("Invalid startup directory.")?).map_err(|e| e.to_string())?;
        let temporary = path.with_extension(format!("{}.tmp", std::process::id()));
        fs::write(&temporary, contents).map_err(|e| e.to_string())?;
        if let Err(error) = fs::rename(&temporary, &path) {
            let _ = fs::remove_file(&temporary);
            return Err(error.to_string());
        }
    } else if let Err(error) = fs::remove_file(&path) {
        if error.kind() != std::io::ErrorKind::NotFound { return Err(error.to_string()); }
    }
    Ok(enabled)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn escapes_desktop_exec_without_shell_expansion_or_field_codes() {
        let value = entry(Path::new("/home/a b/Alfred%f\"$`\\")).unwrap();
        assert!(value.contains("%%f"));
        assert!(value.contains("\\\\\""));
        assert!(value.contains("\\\\$"));
        assert!(entry(Path::new("/tmp/bad\nExec=evil")).is_err());
    }
}
