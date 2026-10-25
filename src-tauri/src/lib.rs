// Digitizer Plus — Tauri 命令层
// 坐标变换与点匹配算法按公开数学方法独立实现，设计理念受 Engauge Digitizer 启发。

mod calibration;
pub use calibration::{
    AxisScale, GraphPoint, PolarCalibration, ScreenPoint, TernaryCalibration, XyCalibration,
};

use serde::Serialize;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! Digitizer Plus core is alive.", name)
}

/// 应用启动时的版本信息（供前端日志显示）
#[tauri::command]
fn app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

/// 打开图片文件对话框，返回 base64 编码的图片与文件名
#[tauri::command]
fn import_image() -> Result<ImagePayload, String> {
    let path = rfd::FileDialog::new()
        .add_filter("图片文件", &["png", "jpg", "jpeg", "bmp", "gif", "webp", "tif", "tiff"])
        .set_title("导入图表图片")
        .pick_file()
        .ok_or("未选择文件")?;

    let bytes = std::fs::read(&path).map_err(|e| format!("读取文件失败: {}", e))?;
    // 解码以校验格式有效性，并拿到原始尺寸
    let img = image::load_from_memory(&bytes).map_err(|e| format!("无法解析图片: {}", e))?;
    let (w, h) = (img.width(), img.height());

    use base64::Engine;
    Ok(ImagePayload {
        name: path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default(),
        mime: mime_guess::from_path(&path)
            .first_or_octet_stream()
            .to_string(),
        width: w,
        height: h,
        data_base64: base64::engine::general_purpose::STANDARD.encode(&bytes),
    })
}

#[derive(Serialize)]
struct ImagePayload {
    name: String,
    mime: String,
    width: u32,
    height: u32,
    data_base64: String,
}

/// 校验前端拖拽传入的图片字节，返回统一 ImagePayload
#[tauri::command]
fn validate_image(
    name: String,
    mime: String,
    data_base64: String,
) -> Result<ImagePayload, String> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&data_base64)
        .map_err(|e| format!("base64 解码失败: {}", e))?;
    let img = image::load_from_memory(&bytes).map_err(|e| format!("无法解析图片: {}", e))?;
    let (w, h) = (img.width(), img.height());
    Ok(ImagePayload {
        name,
        mime: if mime.is_empty() { "image/png".into() } else { mime },
        width: w,
        height: h,
        data_base64: data_base64,
    })
}

/// 将 CSV 文本保存到用户选择的文件
#[tauri::command]
fn export_csv_file(csv: String) -> Result<String, String> {
    let path = rfd::FileDialog::new()
        .add_filter("CSV 文件", &["csv"])
        .set_file_name("digitized_data.csv")
        .set_title("导出数据")
        .save_file()
        .ok_or("未选择保存位置")?;
    std::fs::write(&path, csv).map_err(|e| format!("写入失败: {}", e))?;
    Ok(path.to_string_lossy().to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            app_version,
            import_image,
            validate_image,
            export_csv_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
