// 数据读写走自定义命令，而不是 tauri-plugin-fs。
//
// 原因：fs 插件要按路径配 capability 作用域，而数据目录是用户自己选的（任意路径），
// 配白名单既麻烦又容易被绕过。自定义命令直接把"只做文本文件读写"这件事写成 Rust，
// 范围清晰、不暴露任意文件系统能力给前端。

use std::fs;
use std::path::PathBuf;

use tauri::Manager;

/// 默认数据目录：文档\历史事件线
#[tauri::command]
fn default_data_dir(app: tauri::AppHandle) -> Result<String, String> {
    let docs = app
        .path()
        .document_dir()
        .map_err(|e| format!("找不到「文档」目录：{e}"))?;
    Ok(docs.join("历史事件线").to_string_lossy().to_string())
}

/// 程序所在目录（exe 的同级目录）。
/// 导出 JSON 默认存这里——用户就在这个文件夹里双击打开的，找起来最直接。
#[tauri::command]
fn app_dir() -> Result<String, String> {
    let exe = std::env::current_exe().map_err(|e| format!("取程序路径失败：{e}"))?;
    let dir = exe.parent().ok_or_else(|| "程序路径没有父目录".to_string())?;
    Ok(dir.to_string_lossy().to_string())
}

#[tauri::command]
fn ensure_dir(path: String) -> Result<(), String> {
    fs::create_dir_all(PathBuf::from(&path)).map_err(|e| format!("创建目录失败：{e}"))
}

#[tauri::command]
fn path_exists(path: String) -> bool {
    PathBuf::from(&path).exists()
}

#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    fs::read_to_string(PathBuf::from(&path)).map_err(|e| format!("读取失败：{e}"))
}

/// 写入文本。
///
/// 先写 `.tmp` 再改名，避免写到一半崩溃/断电把原文件写坏——
/// 改名的原子性由文件系统保证。
#[tauri::command]
fn write_text_file(path: String, content: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建目录失败：{e}"))?;
    }
    let tmp = p.with_extension("tmp");
    fs::write(&tmp, content.as_bytes()).map_err(|e| format!("写入临时文件失败：{e}"))?;
    // Windows 上 rename 覆盖已存在文件是允许的
    fs::rename(&tmp, &p).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        format!("替换目标文件失败：{e}")
    })
}

#[tauri::command]
fn list_dir(path: String) -> Result<Vec<String>, String> {
    let dir = PathBuf::from(&path);
    if !dir.is_dir() {
        return Ok(Vec::new());
    }
    let mut out = Vec::new();
    for entry in fs::read_dir(&dir).map_err(|e| format!("读取目录失败：{e}"))? {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };
        if let Some(name) = entry.file_name().to_str() {
            out.push(name.to_string());
        }
    }
    out.sort();
    Ok(out)
}

/// 删除单个文件（备份轮转时清理旧备份用）。文件不存在视为成功。
#[tauri::command]
fn remove_file(path: String) -> Result<(), String> {
    match fs::remove_file(PathBuf::from(&path)) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("删除失败：{e}")),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // single-instance 必须第一个注册。
        // 没有它时，重复启动会去抢同一个 WebView2 数据目录，
        // 表现为 0x800700AA「请求的资源在使用中」并直接崩溃。
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.unminimize();
                let _ = win.show();
                let _ = win.set_focus();
            }
        }))
        // 记住窗口大小与位置
        .plugin(tauri_plugin_window_state::Builder::default().build())
        // 选择数据目录用的文件夹选择器
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            default_data_dir,
            app_dir,
            ensure_dir,
            path_exists,
            read_text_file,
            write_text_file,
            list_dir,
            remove_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
