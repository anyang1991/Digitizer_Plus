//! 坐标变换核心：XY（线性/对数）、极坐标、三元重心坐标。
//! 公开数学方法的独立实现；设计理念受 Engauge Digitizer 启发。

use serde::Serialize;

#[derive(Debug, Clone, Copy, Serialize, PartialEq)]
pub struct ScreenPoint {
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq)]
pub struct GraphPoint {
    pub x: f64,
    pub y: f64,
    /// 三元相图第三分量
    pub c: Option<f64>,
}

#[derive(Debug, Clone, Copy, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum AxisScale {
    Linear,
    Log,
}

/// 单轴两点标定（像素 ↔ 值）
#[derive(Debug, Clone, Copy, Serialize)]
pub struct AxisMap {
    pub p1: f64,
    pub v1: f64,
    pub p2: f64,
    pub v2: f64,
}

impl AxisMap {
    /// 像素 → 值。对数轴：像素与 ln(v) 线性。
    pub fn to_value(&self, p: f64, scale: AxisScale) -> f64 {
        let t = (p - self.p1) / (self.p2 - self.p1);
        match scale {
            AxisScale::Linear => self.v1 + t * (self.v2 - self.v1),
            AxisScale::Log => (self.v1.ln() + t * (self.v2.ln() - self.v1.ln())).exp(),
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize)]
pub struct XyCalibration {
    pub x: Option<AxisMap>,
    pub y: Option<AxisMap>,
    pub x_scale: AxisScale,
    pub y_scale: AxisScale,
}

impl XyCalibration {
    pub fn screen_to_graph(&self, p: ScreenPoint) -> GraphPoint {
        GraphPoint {
            x: self.x.map(|m| m.to_value(p.x, self.x_scale)).unwrap_or(f64::NAN),
            y: self.y.map(|m| m.to_value(p.y, self.y_scale)).unwrap_or(f64::NAN),
            c: None,
        }
    }
}

/// 极坐标标定：圆心 O + 半径点 R + 角度点 θ（度、逆时针）
#[derive(Debug, Clone, Copy, Serialize)]
pub struct PolarCalibration {
    pub o: ScreenPoint,
    pub r_per_pixel: f64,
    /// θ 参考点在屏幕坐标系的角度（y 向下）
    pub ref_angle_screen: f64,
    pub ref_theta_value: f64,
}

impl PolarCalibration {
    pub fn new(o: ScreenPoint, r_pt: ScreenPoint, r_val: f64, theta_pt: ScreenPoint, theta_val: f64) -> Option<Self> {
        let dist = ((r_pt.x - o.x).powi(2) + (r_pt.y - o.y).powi(2)).sqrt();
        if dist < 1e-9 || r_val <= 0.0 {
            return None;
        }
        Some(Self {
            o,
            r_per_pixel: r_val / dist,
            ref_angle_screen: (theta_pt.y - o.y).atan2(theta_pt.x - o.x),
            ref_theta_value: theta_val,
        })
    }

  /// 屏幕 → (θ 度逆时针, r)。θ 域随参考值惯例：ref≥0 输出 [0,360)，ref<0 输出 [-180,180)
  pub fn screen_to_graph(&self, p: ScreenPoint) -> GraphPoint {
    let dx = p.x - self.o.x;
        let dy = p.y - self.o.y;
        let r = (dx * dx + dy * dy).sqrt() * self.r_per_pixel;
        let angle_screen = dy.atan2(dx);
        // 屏幕 y 向下：屏幕系逆时针为负方向
        let mut delta = -(angle_screen - self.ref_angle_screen);
        while delta > std::f64::consts::PI {
            delta -= 2.0 * std::f64::consts::PI;
        }
        while delta <= -std::f64::consts::PI {
            delta += 2.0 * std::f64::consts::PI;
        }
        let mut theta = self.ref_theta_value + delta.to_degrees();
        if self.ref_theta_value >= 0.0 {
            // 用户以 0–360 惯例标定
            theta = ((theta % 360.0) + 360.0) % 360.0;
        } else {
            // 用户以 -180~180 惯例标定
            theta = ((theta + 180.0) % 360.0 + 360.0) % 360.0 - 180.0;
        }
        GraphPoint { x: theta, y: r, c: None }
    }
}

/// 三元相图：三顶点重心坐标（A=100 / B=100 / C=100 各自顶点）
#[derive(Debug, Clone, Copy, Serialize)]
pub struct TernaryCalibration {
    pub a: ScreenPoint,
    pub b: ScreenPoint,
    pub c: ScreenPoint,
}

impl TernaryCalibration {
    /// 屏幕 → 重心 (a, b, c)，和为 100。
    /// 对 2×2 线性方程组 P = αA + βB + γC（γ = 1−α−β）用 Cramer 法则求解。
    pub fn screen_to_graph(&self, p: ScreenPoint) -> GraphPoint {
        let det = (self.a.x - self.c.x) * (self.b.y - self.c.y)
            - (self.b.x - self.c.x) * (self.a.y - self.c.y);
        if det.abs() < 1e-9 {
            return GraphPoint { x: f64::NAN, y: f64::NAN, c: Some(f64::NAN) };
        }
        let alpha = ((p.x - self.c.x) * (self.b.y - self.c.y)
            - (self.b.x - self.c.x) * (p.y - self.c.y))
            / det;
        let beta = ((self.a.x - self.c.x) * (p.y - self.c.y)
            - (p.x - self.c.x) * (self.a.y - self.c.y))
            / det;
        let gamma = 1.0 - alpha - beta;
        GraphPoint { x: alpha * 100.0, y: beta * 100.0, c: Some(gamma * 100.0) }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const EPS: f64 = 1e-9;

    fn sp(x: f64, y: f64) -> ScreenPoint {
        ScreenPoint { x, y }
    }

    /* ---------- XY 线性 ---------- */

    #[test]
    fn xy_linear_basic() {
        let cal = XyCalibration {
            x: Some(AxisMap { p1: 100.0, v1: 0.0, p2: 500.0, v2: 8.0 }),
            y: Some(AxisMap { p1: 300.0, v1: 5.0, p2: 100.0, v2: 25.0 }),
            x_scale: AxisScale::Linear,
            y_scale: AxisScale::Linear,
        };
        let g = cal.screen_to_graph(sp(300.0, 200.0));
        // y: 300px→5 与 100px→25，200px 是中点 → 15
        assert!((g.x - 4.0).abs() < EPS);
        assert!((g.y - 15.0).abs() < EPS, "y={}", g.y);
    }

    /* ---------- XY 对数 ---------- */

    #[test]
    fn xy_log_x_semi_log() {
        // x 轴 log：100px→1, 500px→1000（3 个数量级）
        let cal = XyCalibration {
            x: Some(AxisMap { p1: 100.0, v1: 1.0, p2: 500.0, v2: 1000.0 }),
            y: Some(AxisMap { p1: 0.0, v1: 0.0, p2: 100.0, v2: 10.0 }),
            x_scale: AxisScale::Log,
            y_scale: AxisScale::Linear,
        };
        // 中点应是 10^(1.5) ≈ 31.62
        let g = cal.screen_to_graph(sp(300.0, 0.0));
        assert!((g.x - 1000f64.powf(0.5)).abs() < 1e-9, "x={}", g.x);
        // 已知点回代
        let g2 = cal.screen_to_graph(sp(500.0, 0.0));
        assert!((g2.x - 1000.0).abs() < 1e-9);
    }

    #[test]
    fn xy_log_log() {
        let cal = XyCalibration {
            x: Some(AxisMap { p1: 0.0, v1: 1.0, p2: 300.0, v2: 100.0 }),
            y: Some(AxisMap { p1: 300.0, v1: 1.0, p2: 0.0, v2: 100.0 }),
            x_scale: AxisScale::Log,
            y_scale: AxisScale::Log,
        };
        // (150, 150) → (10, 10)（双对数中点为一个数量级）
        let g = cal.screen_to_graph(sp(150.0, 150.0));
        assert!((g.x - 10.0).abs() < 1e-9, "x={}", g.x);
        assert!((g.y - 10.0).abs() < 1e-9, "y={}", g.y);
    }

    #[test]
    fn xy_log_rejects_nonpositive() {
        // 对数轴上 0 或负值无效，由调用方构造时排除（这里验证 NaN 传播）
        let cal = XyCalibration {
            x: Some(AxisMap { p1: 0.0, v1: 0.0, p2: 100.0, v2: 10.0 }),
            y: None,
            x_scale: AxisScale::Log,
            y_scale: AxisScale::Linear,
        };
        let g = cal.screen_to_graph(sp(50.0, 0.0));
        assert!(g.x.is_nan()); // log(0) 未定义 → exp(ln(0)) = NaN 传播
    }

    /* ---------- 极坐标 ---------- */

    #[test]
    fn polar_basic() {
        // 圆心 (200,150)，半径点在正右方 (300,150) r=10，
        // θ 参考点在正上方 (200,50) θ=90°
        let cal = PolarCalibration::new(sp(200.0, 150.0), sp(300.0, 150.0), 10.0, sp(200.0, 50.0), 90.0).unwrap();
        assert!((cal.r_per_pixel - 0.1).abs() < EPS);

        // 正上方 (200,50)：r=10, θ=90
        let g = cal.screen_to_graph(sp(200.0, 50.0));
        assert!((g.x - 90.0).abs() < 1e-9, "θ={}", g.x);
        assert!((g.y - 10.0).abs() < EPS, "r={}", g.y);

        // 正右方 (300,150)：r=10, θ=0
        let g2 = cal.screen_to_graph(sp(300.0, 150.0));
        assert!((g2.x - 0.0).abs() < 1e-9, "θ={}", g2.x);

        // 正左方 (100,150)：r=10, θ=180
        let g3 = cal.screen_to_graph(sp(100.0, 150.0));
        assert!((g3.x - 180.0).abs() < 1e-9, "θ={}", g3.x);

        // 45° 方向（右上方，屏幕 (270.7,79.3)≈）：θ=45, r=10
        let g4 = cal.screen_to_graph(sp(200.0 + 70.710678, 150.0 - 70.710678));
        assert!((g4.x - 45.0).abs() < 1e-6, "θ={}", g4.x);
        assert!((g4.y - 10.0).abs() < 1e-4, "r={}", g4.y);
    }

    #[test]
    fn polar_theta_offset() {
        // θ 参考点定为 0° 在正上方（数学惯例，ref≥0 → 输出 [0,360)）
        let cal = PolarCalibration::new(sp(200.0, 150.0), sp(300.0, 150.0), 5.0, sp(200.0, 50.0), 0.0).unwrap();
        // 正右方 = 270°（0–360 域）
        let g = cal.screen_to_graph(sp(300.0, 150.0));
        assert!((g.x - 270.0).abs() < 1e-9, "θ={}", g.x);
        assert!((g.y - 5.0).abs() < EPS);
    }

    #[test]
    fn polar_theta_negative_domain() {
        // ref<0 → 输出 [-180,180) 域。参考点在正上方 = -90°，则右方 = -180°
        let cal = PolarCalibration::new(sp(200.0, 150.0), sp(300.0, 150.0), 5.0, sp(200.0, 50.0), -90.0).unwrap();
        let g = cal.screen_to_graph(sp(300.0, 150.0));
        assert!((g.x - (-180.0)).abs() < 1e-9, "θ={}", g.x);
        // 上方 = -90°
        let g2 = cal.screen_to_graph(sp(200.0, 50.0));
        assert!((g2.x - (-90.0)).abs() < 1e-9, "θ={}", g2.x);
    }

    #[test]
    fn polar_rejects_zero_radius() {
        assert!(PolarCalibration::new(sp(1.0, 1.0), sp(1.0, 1.0), 10.0, sp(2.0, 2.0), 0.0).is_none());
        assert!(PolarCalibration::new(sp(0.0, 0.0), sp(10.0, 0.0), 0.0, sp(0.0, -1.0), 90.0).is_none());
    }

    /* ---------- 三元相图 ---------- */

    #[test]
    fn ternary_vertices() {
        // 等边三角形：A 上 (200,50)、B 左下 (100,223)、C 右下 (300,223)
        let cal = TernaryCalibration { a: sp(200.0, 50.0), b: sp(100.0, 223.2), c: sp(300.0, 223.2) };
        let ga = cal.screen_to_graph(sp(200.0, 50.0));
        assert!((ga.x - 100.0).abs() < 1e-9, "a={}", ga.x);
        assert!(ga.y.abs() < 1e-9 && ga.c.unwrap().abs() < 1e-9);

        let gc = cal.screen_to_graph(sp(300.0, 223.2));
        assert!((gc.c.unwrap() - 100.0).abs() < 1e-6, "c={}", gc.c.unwrap());
    }

    #[test]
    fn ternary_centroid() {
        let cal = TernaryCalibration { a: sp(200.0, 50.0), b: sp(100.0, 223.2), c: sp(300.0, 223.2) };
        // 重心 = (33.3, 33.3, 33.3)
        let g = cal.screen_to_graph(sp(200.0, 165.5));
        assert!((g.x - 100.0 / 3.0).abs() < 0.1, "a={}", g.x);
        assert!((g.y - 100.0 / 3.0).abs() < 0.1, "b={}", g.y);
        assert!((g.c.unwrap() - 100.0 / 3.0).abs() < 0.1, "c={}", g.c.unwrap());
        // 和为 100
        assert!((g.x + g.y + g.c.unwrap() - 100.0).abs() < 1e-9);
    }

    #[test]
    fn ternary_edge_midpoint() {
        // BC 边中点 = (0, 50, 50)
        let cal = TernaryCalibration { a: sp(200.0, 50.0), b: sp(100.0, 223.2), c: sp(300.0, 223.2) };
        let g = cal.screen_to_graph(sp(200.0, 223.2));
        assert!(g.x.abs() < 1e-9, "a={}", g.x);
        assert!((g.y - 50.0).abs() < 1e-9, "b={}", g.y);
        assert!((g.c.unwrap() - 50.0).abs() < 1e-9, "c={}", g.c.unwrap());
    }

    /* ---------- CSV ---------- */

    #[test]
    fn graph_point_csv_shape() {
        // 极坐标 theta,r / 三元 a,b,c / xy x,y 的表头约定在命令层测试
        let g = GraphPoint { x: 1.0, y: 2.0, c: Some(3.0) };
        assert_eq!(format!("{},{},{}", g.x, g.y, g.c.unwrap()), "1,2,3");
    }
}
