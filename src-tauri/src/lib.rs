// Digitizer Plus — Tauri 命令层
// 坐标变换与点匹配算法按公开数学方法独立实现（相位相关/仿射变换），
// 设计理念受 Engauge Digitizer 启发，未复制其代码。详见 src/app-meta.ts。

/// 将屏幕坐标转换为图坐标（笛卡尔 XY，线性轴）的 MVP 占位实现：
/// 用两个轴点建立简单的线性映射。极坐标/对数/三元在后续里程碑加入。
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! Digitizer Plus core is alive.", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![greet])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
