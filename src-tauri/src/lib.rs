// Digitizer Plus — Tauri 命令层
// 坐标变换与点匹配算法按公开数学方法独立实现（相位相关/仿射变换），
// 设计理念受 Engauge Digitizer 启发，未复制其代码。详见 src/app-meta.ts。

use serde::Serialize;

/// 将屏幕坐标转换为图坐标（笛卡尔 XY，线性轴）的 MVP 占位实现：
/// 用两个轴点建立简单的线性映射。极坐标/对数/三元在后续里程碑加入。

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! Digitizer Plus core is alive.", name)
}

/// 线性轴两点标定的数据模型
#[derive(Serialize)]
struct CalibrationResult {
    /// 每像素代表的图坐标增量（x 方向）
    x_per_pixel: f64,
    /// 每像素代表的图坐标增量（y 方向）
    y_per_pixel: f64,
}

/// MVP 冒烟测试：给定两个轴点的屏幕/图坐标，计算线性标定。
/// 例如 x=100px 处值为 0.0，x=500px 处值为 8.0 → 每像素 0.02 个单位。
#[tauri::command]
fn calibrate_linear(
    p1_screen: f64,
    v1: f64,
    p2_screen: f64,
    v2: f64,
) -> Result<CalibrationResult, String> {
    let dpixels = p2_screen - p1_screen;
    let dvalues = v2 - v1;
    if dpixels.abs() < f64::EPSILON {
        return Err("两个轴点的屏幕坐标不能重合".into());
    }
    Ok(CalibrationResult {
        x_per_pixel: dvalues / dpixels,
        y_per_pixel: 0.0,
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![greet, calibrate_linear])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_calibrate_linear_normal() {
        // 100px→0.0，500px→8.0 → 每像素 0.02
        let r = calibrate_linear(100.0, 0.0, 500.0, 8.0).unwrap();
        assert!((r.x_per_pixel - 0.02).abs() < 1e-12);
    }

    #[test]
    fn test_calibrate_linear_negative_direction() {
        // 屏幕像素向右增大、数值减小（y 轴翻转的常见情形）
        let r = calibrate_linear(100.0, 10.0, 600.0, 0.0).unwrap();
        assert!((r.x_per_pixel - (-0.02)).abs() < 1e-12);
    }

    #[test]
    fn test_calibrate_linear_rejects_coincident_points() {
        assert!(calibrate_linear(200.0, 1.0, 200.0, 5.0).is_err());
    }
}
