// Digitizer Plus — M1 核心：图像与标定
// 算法为公开数学方法的独立实现（两点线性标定），设计理念受 Engauge Digitizer 启发。

use serde::Serialize;

/// 屏幕像素坐标（图像坐标系，原点左上，y 向下）
#[derive(Debug, Clone, Copy, Serialize, PartialEq)]
pub struct ScreenPoint {
    pub x: f64,
    pub y: f64,
}

/// 图坐标（数据坐标系，如电压/温度，y 向上）
#[derive(Debug, Clone, Copy, Serialize, PartialEq)]
pub struct GraphPoint {
    pub x: f64,
    pub y: f64,
}

/// 两点线性标定：屏幕坐标 ↔ 图坐标的仿射映射（仅缩放+平移，无旋转）。
///
/// x 轴由两个 x 轴点定义（同一水平线），y 轴由两个 y 轴点定义（同一垂直线）。
/// 若只标定了 x 轴，y 方向退化为每像素 1.0。
#[derive(Debug, Clone, Serialize)]
pub struct LinearCalibration {
    pub x_origin_screen: f64,
    pub x_per_pixel: f64,
    pub y_origin_screen: f64,
    pub y_per_pixel: f64,
}

impl LinearCalibration {
    /// 从两个 x 轴点标定 x 方向：screen_x1 → value1, screen_x2 → value2
    pub fn from_x_axis(p1: ScreenPoint, v1: f64, p2: ScreenPoint, v2: f64) -> Result<Self, String> {
        let dp = p2.x - p1.x;
        if dp.abs() < f64::EPSILON {
            return Err("x 轴的两个标定点不能在同一垂直线上".into());
        }
        Ok(Self {
            x_origin_screen: p1.x,
            x_per_pixel: (v2 - v1) / dp,
            y_origin_screen: 0.0,
            y_per_pixel: 1.0,
        })
    }

    /// 在已有标定上追加 y 轴定义
    pub fn with_y_axis(mut self, p1: ScreenPoint, v1: f64, p2: ScreenPoint, v2: f64) -> Result<Self, String> {
        let dp = p2.y - p1.y;
        if dp.abs() < f64::EPSILON {
            return Err("y 轴的两个标定点不能在同一水平线上".into());
        }
        self.y_origin_screen = p1.y;
        self.y_per_pixel = (v2 - v1) / dp;
        Ok(self)
    }

    /// 屏幕 → 图坐标
    pub fn screen_to_graph(&self, p: ScreenPoint) -> GraphPoint {
        GraphPoint {
            x: (p.x - self.x_origin_screen) * self.x_per_pixel,
            y: (p.y - self.y_origin_screen) * self.y_per_pixel,
        }
    }

    /// 图 → 屏幕坐标
    pub fn graph_to_screen(&self, g: GraphPoint) -> ScreenPoint {
        ScreenPoint {
            x: g.x / self.x_per_pixel + self.x_origin_screen,
            y: g.y / self.y_per_pixel + self.y_origin_screen,
        }
    }
}

/// 一个已数字化的数据点
#[derive(Debug, Clone, Serialize)]
pub struct DigitizedPoint {
    pub id: u64,
    pub screen: ScreenPoint,
    pub graph: GraphPoint,
}

/// 将数据点导出为 CSV 文本（两列：x, y）
pub fn export_csv(points: &[DigitizedPoint]) -> String {
    let mut out = String::from("x,y\n");
    for p in points {
        out.push_str(&format!("{},{}\n", p.graph.x, p.graph.y));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_x_axis_calibration() {
        let cal = LinearCalibration::from_x_axis(
            ScreenPoint { x: 100.0, y: 0.0 },
            0.0,
            ScreenPoint { x: 500.0, y: 0.0 },
            8.0,
        )
        .unwrap();
        assert!((cal.x_per_pixel - 0.02).abs() < 1e-12);
    }

    #[test]
    fn test_full_calibration_roundtrip() {
        // x: 100px→0, 500px→8；y: 300px→5, 100px→25（屏幕 y 向下，数值向上）
        let cal = LinearCalibration::from_x_axis(
            ScreenPoint { x: 100.0, y: 300.0 },
            0.0,
            ScreenPoint { x: 500.0, y: 300.0 },
            8.0,
        )
        .unwrap()
        .with_y_axis(
            ScreenPoint { x: 100.0, y: 300.0 },
            5.0,
            ScreenPoint { x: 100.0, y: 100.0 },
            25.0,
        )
        .unwrap();

        // 屏幕 (300, 200)：x = (300-100)*0.02 = 4；y = (200-300)*(-0.1) = 10
        let g = cal.screen_to_graph(ScreenPoint { x: 300.0, y: 200.0 });
        assert!((g.x - 4.0).abs() < 1e-12, "x={}", g.x);
        assert!((g.y - 10.0).abs() < 1e-12, "y={}", g.y);

        // 往返一致
        let s = cal.graph_to_screen(g);
        assert!((s.x - 300.0).abs() < 1e-12 && (s.y - 200.0).abs() < 1e-12);
    }

    #[test]
    fn test_screen_y_down_means_negative_pixel_scale() {
        // 屏幕 y 向下：y 像素增大 → 图 y 减小
        let cal = LinearCalibration::from_x_axis(
            ScreenPoint { x: 0.0, y: 100.0 },
            0.0,
            ScreenPoint { x: 100.0, y: 0.0 },
            10.0,
        )
        .unwrap()
        .with_y_axis(
            ScreenPoint { x: 0.0, y: 100.0 },
            0.0,
            ScreenPoint { x: 0.0, y: 200.0 },
            -10.0,
        )
        .unwrap();
        assert!((cal.y_per_pixel - (-0.1)).abs() < 1e-12);
    }

    #[test]
    fn test_export_csv() {
        let cal = LinearCalibration::from_x_axis(
            ScreenPoint { x: 0.0, y: 0.0 },
            0.0,
            ScreenPoint { x: 100.0, y: 0.0 },
            1.0,
        )
        .unwrap();
        let pts = vec![
            DigitizedPoint { id: 1, screen: ScreenPoint { x: 10.0, y: 10.0 }, graph: cal.screen_to_graph(ScreenPoint { x: 10.0, y: 10.0 }) },
            DigitizedPoint { id: 2, screen: ScreenPoint { x: 20.0, y: 20.0 }, graph: cal.screen_to_graph(ScreenPoint { x: 20.0, y: 20.0 }) },
        ];
        let csv = export_csv(&pts);
        // x 已标定：0.01/px；y 未标定，1:1 透传
        assert_eq!(csv, "x,y\n0.1,10\n0.2,20\n");
    }
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! Digitizer Plus core is alive.", name)
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
        .invoke_handler(tauri::generate_handler![
            greet,
            import_image,
            export_csv_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
