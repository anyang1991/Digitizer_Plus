// Digitizer Plus — 前端核心状态与坐标换算
// 支持：XY（线性/对数轴）、极坐标（O/R/θ 三点标定）、三元相图（重心坐标）。
// 全部为公开数学方法的独立实现；设计理念受 Engauge Digitizer 启发。

export interface ScreenPoint {
  x: number;
  y: number;
}

export interface GraphPoint {
  x: number;
  y: number;
  /** 三元相图第三分量 */
  c?: number;
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

/** 极坐标标定引用点 */
export interface PolarRef {
  o?: ScreenPoint;
  r?: { screen: ScreenPoint; value: number };
  theta?: { screen: ScreenPoint; value: number }; // 度，逆时针
}

/** 三元相图标定：三个顶点（值为固定 100/0/0 组合） */
export interface TernaryRef {
  a?: ScreenPoint;
  b?: ScreenPoint;
  c?: ScreenPoint;
}

export type DigitizeMode =
  | "select"
  | "axis-x"
  | "axis-y"
  | "curve-point"
  | "polar"
  | "ternary";

export type AxisScale = "linear" | "log";

export type CalibKind = "xy" | "polar" | "ternary";

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

/** 撤销历史快照 */
export interface Snapshot {
  axisPoints: AxisPoint[];
  polarRef: PolarRef;
  ternaryRef: TernaryRef;
  points: DigitizedPoint[];
  status: string;
}

/* ------------------------------------------------------------------ */
/* XY：线性/对数轴                                                      */
/* ------------------------------------------------------------------ */

export interface XyCalibration {
  kind: "xy";
  xDefined: boolean;
  yDefined: boolean;
  xScale: AxisScale;
  yScale: AxisScale;
  x: { p1: number; v1: number; p2: number; v2: number } | null;
  y: { p1: number; v1: number; p2: number; v2: number } | null;
}

/**
 * 两点标定（各轴取最后两个点，重复标定以最近为准）。
 * 对数轴映射：像素与 ln(v) 线性，v = exp(插值)，要求 v>0。
 */
export function computeCalibration(
  axisPoints: AxisPoint[],
  xScale: AxisScale = "linear",
  yScale: AxisScale = "linear",
): XyCalibration | null {
  const xs = axisPoints.filter((p) => p.axis === "x").slice(-2);
  const ys = axisPoints.filter((p) => p.axis === "y").slice(-2);

  let x: XyCalibration["x"] = null;
  if (xs.length >= 2 && Math.abs(xs[1].screen.x - xs[0].screen.x) >= 1e-9) {
    if (xScale === "linear" || (xs[0].value > 0 && xs[1].value > 0)) {
      x = {
        p1: xs[0].screen.x, v1: xs[0].value,
        p2: xs[1].screen.x, v2: xs[1].value,
      };
    }
  }
  let y: XyCalibration["y"] = null;
  if (ys.length >= 2 && Math.abs(ys[1].screen.y - ys[0].screen.y) >= 1e-9) {
    if (yScale === "linear" || (ys[0].value > 0 && ys[1].value > 0)) {
      y = {
        p1: ys[0].screen.y, v1: ys[0].value,
        p2: ys[1].screen.y, v2: ys[1].value,
      };
    }
  }
  if (!x && !y) return null;
  return { kind: "xy", xDefined: !!x, yDefined: !!y, xScale, yScale, x, y };
}

function axisToValue(
  p: number,
  axis: { p1: number; v1: number; p2: number; v2: number },
  scale: AxisScale,
): number {
  const t = (p - axis.p1) / (axis.p2 - axis.p1);
  if (scale === "log") {
    return Math.exp(Math.log(axis.v1) + t * (Math.log(axis.v2) - Math.log(axis.v1)));
  }
  return axis.v1 + t * (axis.v2 - axis.v1);
}

export function screenToGraph(
  p: ScreenPoint,
  cal: XyCalibration | PolarCalibration | TernaryCalibration | null,
): GraphPoint | null {
  if (!cal) return null;
  if (cal.kind === "xy") {
    return {
      x: cal.x ? axisToValue(p.x, cal.x, cal.xScale) : NaN,
      y: cal.y ? axisToValue(p.y, cal.y, cal.yScale) : NaN,
    };
  }
  if (cal.kind === "polar") return polarToGraph(p, cal);
  return ternaryToGraph(p, cal);
}

/* ------------------------------------------------------------------ */
/* 极坐标：O（圆心）+ R（半径点）+ θ（角度点，度/逆时针）                  */
/* ------------------------------------------------------------------ */

export interface PolarCalibration {
  kind: "polar";
  o: ScreenPoint;
  /** 每像素代表的半径单位 */
  rPerPixel: number;
  /** θ 参考点在屏幕坐标系的角度（y 向下） */
  refAngleScreen: number;
  refThetaValue: number;
  defined: boolean;
}

export function computePolar(ref: PolarRef): PolarCalibration | null {
  if (!ref.o || !ref.r || !ref.theta) return null;
  const dxr = ref.r.screen.x - ref.o.x;
  const dyr = ref.r.screen.y - ref.o.y;
  const dist = Math.hypot(dxr, dyr);
  if (dist < 1e-9 || ref.r.value <= 0) return null;
  return {
    kind: "polar",
    o: ref.o,
    rPerPixel: ref.r.value / dist,
    refAngleScreen: Math.atan2(ref.theta.screen.y - ref.o.y, ref.theta.screen.x - ref.o.x),
    refThetaValue: ref.theta.value,
    defined: true,
  };
}

/** 屏幕点 → (θ 度逆时针, r)。graph.x = θ，graph.y = r。
 *  θ 域随参考值惯例：ref≥0 输出 [0,360)，ref<0 输出 [-180,180) */
export function polarToGraph(p: ScreenPoint, cal: PolarCalibration): GraphPoint {
  const dx = p.x - cal.o.x;
  const dy = p.y - cal.o.y;
  const r = Math.hypot(dx, dy) * cal.rPerPixel;
  // 屏幕 y 向下：屏幕 atan2 逆时针方向为负
  const angleScreen = Math.atan2(dy, dx);
  let delta = -(angleScreen - cal.refAngleScreen); // 逆时针为正
  // 归一到 (-π, π]
  while (delta > Math.PI) delta -= 2 * Math.PI;
  while (delta <= -Math.PI) delta += 2 * Math.PI;
  let theta = cal.refThetaValue + (delta * 180) / Math.PI;
  if (cal.refThetaValue >= 0) {
    theta = ((theta % 360) + 360) % 360;
  } else {
    theta = ((((theta + 180) % 360) + 360) % 360) - 180;
  }
  return { x: theta, y: r };
}

/* ------------------------------------------------------------------ */
/* 三元相图：三顶点重心坐标（A=100,0,0 / B=0,100,0 / C=0,0,100）          */
/* ------------------------------------------------------------------ */

export interface TernaryCalibration {
  kind: "ternary";
  a: ScreenPoint;
  b: ScreenPoint;
  c: ScreenPoint;
  defined: boolean;
}

export function computeTernary(ref: TernaryRef): TernaryCalibration | null {
  if (!ref.a || !ref.b || !ref.c) return null;
  return { kind: "ternary", a: ref.a, b: ref.b, c: ref.c, defined: true };
}

/** 屏幕点 → 重心坐标 (a, b, c)，和为 100。graph.x=a, graph.y=b, graph.c=c */
export function ternaryToGraph(p: ScreenPoint, cal: TernaryCalibration): GraphPoint {
  const { a, b, c } = cal;
  // Cramer 法则解 P = αA + βB + γC（γ = 1−α−β）
  const det = (a.x - c.x) * (b.y - c.y) - (b.x - c.x) * (a.y - c.y);
  if (Math.abs(det) < 1e-9) return { x: NaN, y: NaN, c: NaN };
  const alpha = ((p.x - c.x) * (b.y - c.y) - (b.x - c.x) * (p.y - c.y)) / det;
  const beta = ((a.x - c.x) * (p.y - c.y) - (p.x - c.x) * (a.y - c.y)) / det;
  const gamma = 1 - alpha - beta;
  return { x: alpha * 100, y: beta * 100, c: gamma * 100 };
}

/* ------------------------------------------------------------------ */
/* 当前激活的标定种类与 CSV                                              */
/* ------------------------------------------------------------------ */

export function activeKind(
  _axisPoints: AxisPoint[],
  polarRef: PolarRef,
  ternaryRef: TernaryRef,
): CalibKind {
  if (ternaryRef.c) return "ternary";
  if (polarRef.theta) return "polar";
  return "xy";
}

export function getConverter(
  axisPoints: AxisPoint[],
  polarRef: PolarRef,
  ternaryRef: TernaryRef,
  xScale: AxisScale,
  yScale: AxisScale,
) {
  const kind = activeKind(axisPoints, polarRef, ternaryRef);
  if (kind === "ternary") return computeTernary(ternaryRef);
  if (kind === "polar") return computePolar(polarRef);
  return computeCalibration(axisPoints, xScale, yScale);
}

/** CSV 序列化：按标定种类输出不同列 */
export function toCsv(points: DigitizedPoint[], kind: CalibKind): string {
  const finite = (v: number | undefined) => v !== undefined && Number.isFinite(v);
  const rows = points
    .filter((p) => p.graph && finite(p.graph.x) && finite(p.graph.y))
    .map((p) => {
      if (kind === "polar") return `${p.graph!.x},${p.graph!.y}`;
      if (kind === "ternary") return `${p.graph!.x},${p.graph!.y},${p.graph!.c}`;
      return `${p.graph!.x},${p.graph!.y}`;
    });
  const header = kind === "polar" ? "theta,r" : kind === "ternary" ? "a,b,c" : "x,y";
  return [header, ...rows].join("\n") + (rows.length ? "\n" : "");
}

export function fmt(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs !== 0 && (abs < 1e-4 || abs >= 1e6)) return n.toExponential(4);
  return String(Math.round(n * 1e6) / 1e6);
}

/** 点的显示文本（按种类） */
export function graphText(p: DigitizedPoint, kind: CalibKind): string {
  if (!p.graph) return "px (未标定)";
  if (kind === "polar") return `θ=${fmt(p.graph.x)}, r=${fmt(p.graph.y)}`;
  if (kind === "ternary")
    return `${fmt(p.graph.x)}, ${fmt(p.graph.y)}, ${fmt(p.graph.c ?? NaN)}`;
  return `${fmt(p.graph.x)}, ${fmt(p.graph.y)}`;
}
