// Digitizer Plus — 前端核心状态与坐标换算（M1）
// 两点线性标定，与 Rust 端 LinearCalibration 保持同一数学定义。

export interface ScreenPoint {
  x: number;
  y: number;
}

export interface GraphPoint {
  x: number;
  y: number;
}

/** 已数字化的点（screen 存图像像素坐标，graph 存换算后的数据坐标） */
export interface DigitizedPoint {
  id: number;
  screen: ScreenPoint;
  graph: GraphPoint | null;
}

/** 标定轴点：用户在图上点击后输入的已知坐标 */
export interface AxisPoint {
  id: number;
  screen: ScreenPoint;
  value: number;
  axis: "x" | "y";
}

export type DigitizeMode = "select" | "axis-x" | "axis-y" | "curve-point";

export interface ImageInfo {
  name: string;
  mime: string;
  width: number;
  height: number;
  dataBase64: string;
}

let nextPointId = 1;
export function nextId(): number {
  return nextPointId++;
}

/**
 * 两点线性标定（前端镜像实现，用于实时预览；权威计算在 Rust 端）。
 * x 轴需要 2 个 axis="x" 的点，y 轴需要 2 个 axis="y" 的点。
 */
export function computeCalibration(axisPoints: AxisPoint[]) {
  const xs = axisPoints.filter((p) => p.axis === "x");
  const ys = axisPoints.filter((p) => p.axis === "y");

  let xPerPixel: number | null = null;
  let xOrigin = 0;
  if (xs.length >= 2) {
    const dp = xs[1].screen.x - xs[0].screen.x;
    if (Math.abs(dp) < 1e-9) return null;
    xPerPixel = (xs[1].value - xs[0].value) / dp;
    xOrigin = xs[0].screen.x;
  }

  let yPerPixel: number | null = null;
  let yOrigin = 0;
  if (ys.length >= 2) {
    const dp = ys[1].screen.y - ys[0].screen.y;
    if (Math.abs(dp) < 1e-9) return null;
    yPerPixel = (ys[1].value - ys[0].screen.y * 0) / dp; // placeholder, replaced below
    yPerPixel = (ys[1].value - ys[0].value) / dp;
    yOrigin = ys[0].screen.y;
  }

  return {
    xDefined: xPerPixel !== null,
    xPerPixel: xPerPixel ?? 1,
    xOrigin,
    yDefined: yPerPixel !== null,
    yPerPixel: yPerPixel ?? 1,
    yOrigin,
  };
}

export function screenToGraph(
  p: ScreenPoint,
  cal: ReturnType<typeof computeCalibration> | null,
): GraphPoint | null {
  if (!cal) return null;
  return {
    x: cal.xDefined ? (p.x - cal.xOrigin) * cal.xPerPixel : NaN,
    y: cal.yDefined ? (p.y - cal.yOrigin) * cal.yPerPixel : NaN,
  };
}

/** CSV 序列化（与 Rust export_csv 一致：两列 x,y） */
export function toCsv(points: DigitizedPoint[]): string {
  const rows = points
    .filter((p) => p.graph && Number.isFinite(p.graph.x) && Number.isFinite(p.graph.y))
    .map((p) => `${p.graph!.x},${p.graph!.y}`);
  return ["x,y", ...rows].join("\n") + (rows.length ? "\n" : "");
}

export function fmt(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs !== 0 && (abs < 1e-4 || abs >= 1e6)) return n.toExponential(4);
  return String(Math.round(n * 1e6) / 1e6);
}
