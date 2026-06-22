use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::Path;
use sysinfo::Disks;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct CameraDrive {
    pub name: String,
    pub mount_point: String,
    pub dcim_path: String,
    pub total_space: u64,
    pub available_space: u64,
}

#[tauri::command]
fn detect_camera_drives() -> Result<Vec<CameraDrive>, String> {
    let mut drives = Vec::new();
    let disks = Disks::new_with_refreshed_list();

    for disk in disks.list() {
        if disk.is_removable() {
            let mount_point = disk.mount_point();
            let dcim_path = mount_point.join("DCIM");
            if dcim_path.exists() && dcim_path.is_dir() {
                drives.push(CameraDrive {
                    name: disk.name().to_string_lossy().to_string(),
                    mount_point: mount_point.to_string_lossy().to_string(),
                    dcim_path: dcim_path.to_string_lossy().to_string(),
                    total_space: disk.total_space(),
                    available_space: disk.available_space(),
                });
            }
        }
    }
    Ok(drives)
}

#[tauri::command]
async fn copy_to_staging(source: String, target: String) -> Result<u64, String> {
    let source_path = Path::new(&source);
    let target_path = Path::new(&target);

    // Ensure parent dir exists
    if let Some(parent) = target_path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    // Since this is async tauri command, we can just use tokio::fs::copy
    let copied = tokio::fs::copy(source_path, target_path)
        .await
        .map_err(|e| e.to_string())?;
    Ok(copied)
}

#[tauri::command]
async fn calculate_sha256(filepath: String) -> Result<String, String> {
    use tokio::io::AsyncReadExt;

    let path = Path::new(&filepath);
    let mut file = tokio::fs::File::open(path)
        .await
        .map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    let mut buffer = [0; 65536]; // 64KB chunks

    loop {
        let n = file.read(&mut buffer).await.map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        hasher.update(&buffer[..n]);
    }

    let result = hasher.finalize();
    Ok(hex::encode(result))
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct DcimFile {
    pub file_path: String,
    pub file_name: String,
    pub file_size: u64,
}

#[tauri::command]
fn scan_dcim_files(dcim_path: String) -> Result<Vec<DcimFile>, String> {
    let mut files = Vec::new();
    let walker = walkdir::WalkDir::new(&dcim_path).into_iter();

    for entry in walker.filter_map(|e| e.ok()) {
        if entry.file_type().is_file() {
            if let Ok(metadata) = entry.metadata() {
                files.push(DcimFile {
                    file_path: entry.path().to_string_lossy().to_string(),
                    file_name: entry.file_name().to_string_lossy().to_string(),
                    file_size: metadata.len(),
                });
            }
        }
    }

    Ok(files)
}

#[tauri::command]
fn delete_staging_file(filepath: String) -> Result<(), String> {
    let path = Path::new(&filepath);
    if path.exists() {
        fs::remove_file(path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

use keyring::Entry;

#[tauri::command]
fn set_keyring_token(token: String) -> Result<(), String> {
    let entry = Entry::new("id.go.kominfo.rekam", "auth_token").map_err(|e| e.to_string())?;
    entry.set_password(&token).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn get_keyring_token() -> Result<String, String> {
    let entry = Entry::new("id.go.kominfo.rekam", "auth_token").map_err(|e| e.to_string())?;
    entry.get_password().map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_keyring_token() -> Result<(), String> {
    let entry = Entry::new("id.go.kominfo.rekam", "auth_token").map_err(|e| e.to_string())?;
    let _ = entry.delete_password(); // Ignore error if not found
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_sql::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            detect_camera_drives,
            copy_to_staging,
            calculate_sha256,
            delete_staging_file,
            scan_dcim_files,
            set_keyring_token,
            get_keyring_token,
            delete_keyring_token
        ])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
