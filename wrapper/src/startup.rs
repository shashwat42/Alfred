use std::{os::windows::ffi::OsStrExt, ptr, sync::Mutex};
use tauri::WebviewWindow;
use windows_sys::Win32::{
    Foundation::{ERROR_FILE_NOT_FOUND, ERROR_SUCCESS},
    System::Registry::{
        HKEY_CURRENT_USER, REG_SZ, RRF_RT_REG_SZ, RegDeleteKeyValueW, RegGetValueW, RegSetKeyValueW,
    },
};

static STARTUP_WRITE: Mutex<()> = Mutex::new(());

fn wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(Some(0)).collect()
}

fn authorize(window: &WebviewWindow) -> Result<(), String> {
    if window.label() != "main"
        || !window
            .url()
            .is_ok_and(|url| crate::permissions::trusted_origin(&url))
    {
        return Err("Startup settings must come from Alfred settings.".into());
    }
    Ok(())
}

fn key() -> Vec<u16> {
    wide(r"Software\Microsoft\Windows\CurrentVersion\Run")
}

fn startup_command(minimized: bool) -> Result<Vec<u16>, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let arguments = if minimized {
        format!(" {}", crate::START_MINIMIZED_ARG)
    } else {
        String::new()
    };
    Ok(std::iter::once(b'"' as u16)
        .chain(exe.as_os_str().encode_wide())
        .chain(Some(b'"' as u16))
        .chain(arguments.encode_utf16())
        .chain(Some(0))
        .collect())
}

fn read_command() -> Result<Option<Vec<u16>>, String> {
    let mut data = vec![0u16; 32768];
    let mut bytes = (data.len() * 2) as u32;
    // All buffers and nul-terminated names live through the registry call.
    let result = unsafe {
        RegGetValueW(
            HKEY_CURRENT_USER,
            key().as_ptr(),
            wide("Alfred").as_ptr(),
            RRF_RT_REG_SZ,
            ptr::null_mut(),
            data.as_mut_ptr().cast(),
            &mut bytes,
        )
    };
    if result == ERROR_FILE_NOT_FOUND {
        return Ok(None);
    }
    if result != ERROR_SUCCESS {
        return Err(format!(
            "Could not read Windows startup settings ({result})."
        ));
    }
    data.truncate(bytes as usize / 2);
    Ok(Some(data))
}

fn read_enabled() -> Result<bool, String> {
    let Some(command) = read_command()? else {
        return Ok(false);
    };
    Ok(command == startup_command(true)? || command == startup_command(false)?)
}

fn write_startup(enabled: bool) -> Result<(), String> {
    let result = if enabled {
        let command = startup_command(true)?;
        unsafe {
            RegSetKeyValueW(
                HKEY_CURRENT_USER,
                key().as_ptr(),
                wide("Alfred").as_ptr(),
                REG_SZ,
                command.as_ptr().cast(),
                (command.len() * 2) as u32,
            )
        }
    } else {
        unsafe { RegDeleteKeyValueW(HKEY_CURRENT_USER, key().as_ptr(), wide("Alfred").as_ptr()) }
    };
    if result != ERROR_SUCCESS && !(result == ERROR_FILE_NOT_FOUND && !enabled) {
        return Err(format!(
            "Could not update Windows startup settings ({result})."
        ));
    }
    Ok(())
}

pub fn upgrade_legacy_startup() -> Result<(), String> {
    let _guard = STARTUP_WRITE.lock().map_err(|e| e.to_string())?;
    if let Some(command) = read_command()?
        && command == startup_command(false)?
    {
        write_startup(true)?;
    }
    Ok(())
}

#[tauri::command]
pub fn get_launch_on_startup(window: WebviewWindow) -> Result<bool, String> {
    authorize(&window)?;
    read_enabled()
}

#[tauri::command]
pub fn set_launch_on_startup(window: WebviewWindow, enabled: bool) -> Result<bool, String> {
    authorize(&window)?;
    let _guard = STARTUP_WRITE.lock().map_err(|e| e.to_string())?;
    write_startup(enabled)?;
    read_enabled()
}
