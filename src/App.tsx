// Digitizer Plus — 主界面：XY(线性/对数) · 极坐标 · 三元相图
// 设计理念受 Engauge Digitizer 启发（详见 app-meta.ts），实现为独立原创。

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import ImageCanvas from "./ImageCanvas";
import UpdateButton from "./UpdateButton";
import {
  activeKind,
  computeCalibration,
  computePolar,
  computeTernary,
  fmt,
  getConverter,
  graphText,
  nextId,
  screenToGraph,
  toCsv,
  type AxisPoint,
  type AxisScale,
  type DigitizedPoint,
  type DigitizeMode,
  type ImageInfo,
  type PolarRef,
  type ScreenPoint,
  type TernaryRef,
} from "./core";

type ChartType = "xy" | "polar" | "ternary";

const MODES: { key: DigitizeMode; label: string; hint: string; hotkey: string; types: ChartType[] }[] = [
  { key: "select", label: "选择", hint: "浏览图像", hotkey: "V", types: ["xy", "polar", "ternary"] },
  { key: "axis-x", label: "X 轴点", hint: "X 轴上点击两个已知刻度", hotkey: "X", types: ["xy"] },
  { key: "axis-y", label: "Y 轴点", hint: "Y 轴上点击两个已知刻度", hotkey: "Y", types: ["xy"] },
  { key: "polar", label: "极坐标点", hint: "依次点击 O → R → θ", hotkey: "O", types: ["polar"] },
  { key: "ternary", label: "顶点", hint: "依次点击 A → B → C", hotkey: "T", types: ["ternary"] },
  { key: "curve-point", label: "取点", hint: "沿曲线点击添加数据点", hotkey: "P", types: ["xy", "polar", "ternary"] },
];

const CHART_SELECT: { key: ChartType; label: string }[] = [
  { key: "xy", label: "XY 图" },
  { key: "polar", label: "极坐标图" },
  { key: "ternary", label: "三元相图" },
];

export default function App() {
  const [image, setImage] = useState<ImageInfo | null>(null);
  const [chartType, setChartType] = useState<ChartType>("xy");
  const [xScale, setXScale] = useState<AxisScale>("linear");
  const [yScale, setYScale] = useState<AxisScale>("linear");
  const [mode, setMode] = useState<DigitizeMode>("select");
  const [axisPoints, setAxisPoints] = useState<AxisPoint[]>([]);
  const [polarRef, setPolarRef] = useState<PolarRef>({});
  const [ternaryRef, setTernaryRef] = useState<TernaryRef>({});
  const [points, setPoints] = useState<DigitizedPoint[]>([]);
  const [pending, setPending] = useState<{ label: string; screen: ScreenPoint } | null>(null);
  const [valueInput, setValueInput] = useState("");
  const [status, setStatus] = useState("导入一张图表图片开始");
  const viewStateRef = useRef<{ scale: number; pan: { x: number; y: number } }>({ scale: 1, pan: { x: 0, y: 0 } });

  const onViewState = useCallback((v: { scale: number; pan: { x: number; y: number } }) => {
    viewStateRef.current = v;
  }, []);

  const kind = activeKind(axisPoints, polarRef, ternaryRef);
  const converter = useMemo(
    () => getConverter(axisPoints, polarRef, ternaryRef, xScale, yScale),
    [axisPoints, polarRef, ternaryRef, xScale, yScale],
  );
  const xyCal = chartType === "xy" ? computeCalibration(axisPoints, xScale, yScale) : null;
  const polarCal = chartType === "polar" ? computePolar(polarRef) : null;
  const ternaryCal = chartType === "ternary" ? computeTernary(ternaryRef) : null;
  const calibrated = !!(xyCal || polarCal || ternaryCal);

  const recomputeGraphs = useCallback(
    (pts: DigitizedPoint[], conv: typeof converter) => {
      return pts.map((p) => ({ ...p, graph: screenToGraph(p.screen, conv) }));
    },
    [],
  );

  /* ---------------- 导入/导出 ---------------- */

  const applyImage = (img: ImageInfo) => {
    setImage(img);
    setChartType("xy");
    setXScale("linear");
    setYScale("linear");
    setMode("select");
    setAxisPoints([]);
    setPolarRef({});
    setTernaryRef({});
    setPoints([]);
    setPending(null);
    setStatus(`已导入 ${img.name} (${img.width}×${img.height}) — 选择图表类型后开始标定`);
  };

  const handleImport = async () => {
    try {
      applyImage(await invoke<ImageInfo>("import_image"));
    } catch (e) {
      if (String(e).includes("未选择")) return;
      setStatus(`导入失败: ${e}`);
    }
  };

  const handleExport = async () => {
    const csv = toCsv(points, kind);
    if (!csv.trim()) {
      setStatus("没有可导出的数据点");
      return;
    }
    try {
      const path = await invoke<string>("export_csv_file", { csv });
      setStatus(`已导出到 ${path}`);
    } catch (e) {
      if (String(e).includes("未选择")) return;
      setStatus(`导出失败: ${e}`);
    }
  };

  /* ---------------- 点击处理 ---------------- */

  const handleImageClick = (img: ScreenPoint) => {
    if (!image) return;

    // XY 轴点
    if (mode === "axis-x" || mode === "axis-y") {
      setPending({ label: mode === "axis-x" ? "X 轴点坐标值" : "Y 轴点坐标值", screen: img });
      setValueInput("");
      return;
    }
    // 极坐标参考点
    if (mode === "polar") {
      if (!polarRef.o) {
        setPolarRef({ ...polarRef, o: img });
        setStatus("①/③ 圆心 O 已设定 — 点击半径 R 的已知点");
      } else if (!polarRef.r) {
        setPending({ label: "半径 R 的值", screen: img });
        setValueInput("");
      } else if (!polarRef.theta) {
        setPending({ label: "该点的角度 θ（度，逆时针）", screen: img });
        setValueInput("");
      }
      return;
    }
    // 三元顶点
    if (mode === "ternary") {
      if (!ternaryRef.a) {
        setTernaryRef({ ...ternaryRef, a: img });
        setStatus("①/③ 顶点 A（100% A 组元）已设定 — 点击顶点 B");
      } else if (!ternaryRef.b) {
        setTernaryRef({ ...ternaryRef, b: img });
        setStatus("②/③ 顶点 B 已设定 — 点击顶点 C");
      } else if (!ternaryRef.c) {
        setTernaryRef({ ...ternaryRef, c: img });
        setStatus("✅ 三元标定完成！切换到「取点」模式");
      }
      return;
    }
    // 数据点
    if (mode === "curve-point") {
      const p: DigitizedPoint = { id: nextId(), screen: img, graph: null };
      setPoints((prev) => recomputeGraphs([...prev, p], converter));
      const n = points.length + 1;
      setStatus(
        calibrated
          ? `已添加第 ${n} 个数据点`
          : `已添加第 ${n} 个数据点（当前为像素坐标，完成标定后自动换算）`,
      );
    }
  };

  const submitValue = () => {
    if (!pending) return;
    const v = parseFloat(valueInput);
    if (!Number.isFinite(v)) {
      setStatus("请输入有效的数值");
      return;
    }
    // 极坐标流程
    if (mode === "polar" && polarRef.o && !polarRef.r) {
      setPolarRef({ ...polarRef, r: { screen: pending.screen, value: v } });
      setPending(null);
      setStatus("②/③ 半径 R 已设定 — 点击角度 θ 的已知点");
      return;
    }
    if (mode === "polar" && polarRef.o && polarRef.r && !polarRef.theta) {
      const next = { ...polarRef, theta: { screen: pending.screen, value: v } };
      setPolarRef(next);
      setPending(null);
      setStatus(computePolar(next) ? "✅ 极坐标标定完成！切换到「取点」模式" : "标定无效（半径需>0 且三点不重合）");
      return;
    }
    // XY 轴点
    const axis: "x" | "y" = mode === "axis-x" ? "x" : "y";
    const next: AxisPoint[] = [...axisPoints, { id: nextId(), screen: pending.screen, value: v, axis }];
    setAxisPoints(next);
    setPending(null);
    const c = computeCalibration(next, xScale, yScale);
    setPoints((prev) => recomputeGraphs(prev, c));
    const n = next.filter((p) => p.axis === axis).length;
    const defined = axis === "x" ? c?.xDefined : c?.yDefined;
    if (c?.xDefined && c?.yDefined) {
      setStatus("✅ 标定完成！切换到「取点」模式沿曲线添加数据点");
    } else if (defined) {
      setStatus(`${axis.toUpperCase()} 轴已定义 — 继续标定另一轴`);
    } else {
      setStatus(`${axis.toUpperCase()} 轴点 ${n}/2 — 还需 ${2 - Math.min(n, 2)} 个`);
    }
  };

  const undoLast = () => {
    if (pending) {
      setPending(null);
      return;
    }
    if (points.length) {
      setPoints((prev) => prev.slice(0, -1));
      return;
    }
    if (ternaryRef.c) {
      setTernaryRef({ ...ternaryRef, c: undefined });
      setStatus("已撤销顶点 C");
      return;
    }
    if (ternaryRef.b) {
      setTernaryRef({ ...ternaryRef, b: undefined });
      setStatus("已撤销顶点 B");
      return;
    }
    if (ternaryRef.a) {
      setTernaryRef({});
      setStatus("已撤销顶点 A");
      return;
    }
    if (polarRef.theta) {
      setPolarRef({ ...polarRef, theta: undefined });
      setStatus("已撤销 θ 点");
      return;
    }
    if (polarRef.r) {
      setPolarRef({ ...polarRef, r: undefined });
      setStatus("已撤销 R 点");
      return;
    }
    if (polarRef.o) {
      setPolarRef({});
      setStatus("已撤销圆心 O");
      return;
    }
    if (axisPoints.length) {
      const next = axisPoints.slice(0, -1);
      setAxisPoints(next);
      setPoints((prev) => recomputeGraphs(prev, computeCalibration(next, xScale, yScale)));
    }
  };

  const deletePoint = (id: number) => {
    setPoints((prev) => prev.filter((p) => p.id !== id));
  };

  /* ---------------- 快捷键 ---------------- */

  const onKey = (e: React.KeyboardEvent) => {
    if (pending && (e.key === "Enter" || e.key === "Escape")) {
      if (e.key === "Enter") submitValue();
      else setPending(null);
      return;
    }
    const k = e.key.toLowerCase();
    if (k === "v") setMode("select");
    else if (k === "x" && chartType === "xy") setMode("axis-x");
    else if (k === "y" && chartType === "xy") setMode("axis-y");
    else if (k === "o" && chartType === "polar") setMode("polar");
    else if (k === "t" && chartType === "ternary") setMode("ternary");
    else if (k === "p") setMode("curve-point");
    else if ((e.ctrlKey || e.metaKey) && k === "z") {
      e.preventDefault();
      undoLast();
    }
  };

  /* ---------------- E2E 钩子 ---------------- */

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    (window as never as Record<string, unknown>).__DIGITIZER_E2E__ = {
      loadImage: (info: ImageInfo) => applyImage(info),
      simulateClick: (imgX: number, imgY: number) => handleImageClick({ x: imgX, y: imgY }),
      getState: () => ({
        chartType,
        xScale,
        yScale,
        xDefined: !!xyCal?.xDefined,
        yDefined: !!xyCal?.yDefined,
        polarDefined: !!polarCal,
        ternaryDefined: !!ternaryCal,
        polarStep: polarRef.theta ? 3 : polarRef.r ? 2 : polarRef.o ? 1 : 0,
        ternaryStep: ternaryRef.c ? 3 : ternaryRef.b ? 2 : ternaryRef.a ? 1 : 0,
        points,
        status,
        csv: toCsv(points, kind),
      }),
      getView: () => viewStateRef.current,
      setChartType: (t: ChartType) => setChartType(t),
      setXScale: (s: AxisScale) => setXScale(s),
      setYScale: (s: AxisScale) => setYScale(s),
      setMode: (m: DigitizeMode) => setMode(m),
    };
  });

  /* ---------------- 画布叠加层 ---------------- */

  const renderOverlay = useCallback(
    (ctx: CanvasRenderingContext2D, toScreen: (p: ScreenPoint) => ScreenPoint) => {
      // XY 轴点：空心方块（x 橙 / y 青）
      for (const ap of axisPoints) {
        const s = toScreen(ap.screen);
        ctx.strokeStyle = ap.axis === "x" ? "#fb923c" : "#22d3ee";
        ctx.lineWidth = 2;
        ctx.strokeRect(s.x - 6, s.y - 6, 12, 12);
        ctx.fillStyle = ctx.strokeStyle;
        ctx.font = "12px ui-monospace, monospace";
        ctx.fillText(String(ap.value), s.x + 10, s.y - 10);
      }
      // 极坐标参考：O 十字 / R 圆圈 / θ 射线
      if (polarRef.o) {
        const o = toScreen(polarRef.o);
        ctx.strokeStyle = "#a78bfa";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(o.x - 8, o.y); ctx.lineTo(o.x + 8, o.y);
        ctx.moveTo(o.x, o.y - 8); ctx.lineTo(o.x, o.y + 8);
        ctx.stroke();
        ctx.fillStyle = "#a78bfa";
        ctx.font = "12px ui-monospace, monospace";
        ctx.fillText("O", o.x + 10, o.y - 10);
        if (polarRef.r) {
          const rp = toScreen(polarRef.r.screen);
          ctx.beginPath();
          ctx.arc(rp.x, rp.y, 6, 0, Math.PI * 2);
          ctx.stroke();
          ctx.fillText(`R=${polarRef.r.value}`, rp.x + 10, rp.y - 10);
          ctx.strokeStyle += "66";
          ctx.beginPath();
          ctx.moveTo(o.x, o.y);
          ctx.lineTo(rp.x, rp.y);
          ctx.stroke();
          if (polarRef.theta) {
            const tp = toScreen(polarRef.theta.screen);
            ctx.strokeStyle = "#a78bfa";
            ctx.beginPath();
            ctx.moveTo(o.x, o.y);
            ctx.lineTo(tp.x, tp.y);
            ctx.stroke();
            ctx.fillText(`θ=${polarRef.theta.value}°`, tp.x + 10, tp.y - 10);
          }
        }
      }
      // 三元顶点：三角形
      if (ternaryRef.a && ternaryRef.b && ternaryRef.c) {
        const [ta, tb, tc] = [toScreen(ternaryRef.a), toScreen(ternaryRef.b), toScreen(ternaryRef.c)];
        ctx.strokeStyle = "#34d39988";
        ctx.beginPath();
        ctx.moveTo(ta.x, ta.y);
        ctx.lineTo(tb.x, tb.y);
        ctx.lineTo(tc.x, tc.y);
        ctx.closePath();
        ctx.stroke();
      }
      for (const [ref, label] of [
        [ternaryRef.a, "A"], [ternaryRef.b, "B"], [ternaryRef.c, "C"],
      ] as const) {
        if (ref) {
          const s = toScreen(ref);
          ctx.fillStyle = "#34d399";
          ctx.font = "bold 13px ui-monospace, monospace";
          ctx.fillText(label, s.x + 8, s.y - 8);
        }
      }
      // 数据点
      ctx.fillStyle = "#ef4444";
      for (const p of points) {
        const s = toScreen(p.screen);
        ctx.beginPath();
        ctx.arc(s.x, s.y, 4, 0, Math.PI * 2);
        ctx.fill();
      }
    },
    [axisPoints, polarRef, ternaryRef, points],
  );

  /* ---------------- 拖拽导入 ---------------- */

  const [dragOver, setDragOver] = useState(false);
  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let bin = "";
      for (let i = 0; i < bytes.length; i += 0x8000) {
        bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      }
      applyImage(
        await invoke<ImageInfo>("validate_image", {
          name: file.name,
          mime: file.type || "image/png",
          dataBase64: btoa(bin),
        }),
      );
    } catch (err) {
      setStatus(`导入失败: ${err}`);
    }
  };

  const visibleModes = MODES.filter((m) => m.types.includes(chartType));

  return (
    <div
      className={"flex h-screen flex-col bg-neutral-950 text-neutral-100 " + (dragOver ? "ring-2 ring-inset ring-sky-500" : "")}
      onKeyDown={onKey}
      tabIndex={-1}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDragOver(false); }}
      onDrop={handleDrop}
    >
      {/* 顶栏 */}
      <header className="flex items-center gap-3 border-b border-neutral-800 px-4 py-2.5">
        <h1 className="text-base font-bold tracking-tight">
          Digitizer<span className="text-sky-500">Plus</span>
        </h1>
        <select
          value={chartType}
          onChange={(e) => {
            setChartType(e.target.value as ChartType);
            setMode("select");
          }}
          className="rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm"
        >
          {CHART_SELECT.map((t) => (
            <option key={t.key} value={t.key}>{t.label}</option>
          ))}
        </select>
        {chartType === "xy" && (
          <div className="flex items-center gap-1 text-xs">
            <span className="text-neutral-500">X 轴</span>
            <button
              onClick={() => { setXScale(xScale === "linear" ? "log" : "linear"); setAxisPoints([]); }}
              className={"rounded px-2 py-1 font-mono " + (xScale === "log" ? "bg-orange-600/30 text-orange-400" : "bg-neutral-800 text-neutral-400")}
              title="切换线性/对数（切换后需重新标定）"
            >
              {xScale === "log" ? "log" : "linear"}
            </button>
            <span className="text-neutral-500">Y 轴</span>
            <button
              onClick={() => { setYScale(yScale === "linear" ? "log" : "linear"); setAxisPoints([]); }}
              className={"rounded px-2 py-1 font-mono " + (yScale === "log" ? "bg-cyan-600/30 text-cyan-400" : "bg-neutral-800 text-neutral-400")}
            >
              {yScale === "log" ? "log" : "linear"}
            </button>
          </div>
        )}
        <button onClick={handleImport} className="rounded-md bg-sky-600 px-3 py-1.5 text-sm font-medium hover:bg-sky-500">
          导入图片
        </button>
        <button
          onClick={handleExport}
          disabled={!points.some((p) => p.graph)}
          className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
        >
          导出 CSV
        </button>
        <UpdateButton />
        <div className="ml-auto text-xs text-neutral-500">Win · macOS · Linux</div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* 左侧工具栏 */}
        <nav className="flex w-32 flex-col gap-1 border-r border-neutral-800 p-2">
          {visibleModes.map((m) => (
            <button
              key={m.key}
              onClick={() => setMode(m.key)}
              disabled={!image}
              title={`${m.hint} (${m.hotkey})`}
              className={
                "rounded-md px-3 py-2 text-left text-sm disabled:cursor-not-allowed disabled:opacity-30 " +
                (mode === m.key
                  ? "bg-sky-600/20 font-medium text-sky-400 ring-1 ring-sky-600/50"
                  : "text-neutral-300 hover:bg-neutral-800")
              }
            >
              <span className="mr-1.5 font-mono text-xs text-neutral-500">{m.hotkey}</span>
              {m.label}
            </button>
          ))}
          <button
            onClick={undoLast}
            disabled={!image}
            className="mt-auto rounded-md px-3 py-2 text-left text-sm text-neutral-400 hover:bg-neutral-800 disabled:opacity-30"
            title="Ctrl+Z"
          >
            ↩ 撤销
          </button>
        </nav>

        {/* 主画布 */}
        <main className="relative min-w-0 flex-1">
          <ImageCanvas
            imageSrc={image ? `data:${image.mime};base64,${image.dataBase64}` : null}
            onImageClick={handleImageClick}
            renderOverlay={renderOverlay}
            onViewState={onViewState}
          />
          {pending && (
            <div className="absolute left-1/2 top-4 w-72 -translate-x-1/2 rounded-lg border border-neutral-700 bg-neutral-900 p-3 shadow-xl">
              <p className="mb-2 text-sm">{pending.label}：</p>
              <div className="flex gap-2">
                <input
                  autoFocus
                  value={valueInput}
                  onChange={(e) => setValueInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") submitValue();
                    if (e.key === "Escape") setPending(null);
                  }}
                  className="min-w-0 flex-1 rounded border border-neutral-700 bg-neutral-800 px-2 py-1.5 font-mono text-sm outline-none focus:border-sky-500"
                />
                <button onClick={submitValue} className="rounded bg-sky-600 px-3 py-1.5 text-sm hover:bg-sky-500">
                  确定
                </button>
              </div>
              <p className="mt-2 text-xs text-neutral-500">Esc 取消 · 回车确认</p>
            </div>
          )}
        </main>

        {/* 右侧面板 */}
        <aside className="flex w-72 flex-col border-l border-neutral-800">
          <section className="border-b border-neutral-800 p-3">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-500">
              标定状态
            </h2>
            {chartType === "xy" && (
              <div className="space-y-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-orange-400">X 轴 ({xScale})</span>
                  <span>{xyCal?.xDefined ? "✅" : `未定义 (${axisPoints.filter((p) => p.axis === "x").length}/2)`}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-cyan-400">Y 轴 ({yScale})</span>
                  <span>{xyCal?.yDefined ? "✅" : `未定义 (${axisPoints.filter((p) => p.axis === "y").length}/2)`}</span>
                </div>
              </div>
            )}
            {chartType === "polar" && (
              <div className="space-y-1 text-sm">
                <div className="flex justify-between"><span className="text-violet-400">① 圆心 O</span><span>{polarRef.o ? "✅" : "…"}</span></div>
                <div className="flex justify-between"><span className="text-violet-400">② 半径 R</span><span>{polarRef.r ? "✅" : "…"}</span></div>
                <div className="flex justify-between"><span className="text-violet-400">③ 角度 θ</span><span>{polarRef.theta ? "✅" : "…"}</span></div>
                {polarCal && <div className="pt-1 font-mono text-xs text-neutral-500">{fmt(polarCal.rPerPixel)}/px</div>}
              </div>
            )}
            {chartType === "ternary" && (
              <div className="space-y-1 text-sm">
                <div className="flex justify-between"><span className="text-emerald-400">① 顶点 A</span><span>{ternaryRef.a ? "✅" : "…"}</span></div>
                <div className="flex justify-between"><span className="text-emerald-400">② 顶点 B</span><span>{ternaryRef.b ? "✅" : "…"}</span></div>
                <div className="flex justify-between"><span className="text-emerald-400">③ 顶点 C</span><span>{ternaryRef.c ? "✅" : "…"}</span></div>
              </div>
            )}
          </section>
          <section className="flex min-h-0 flex-1 flex-col p-3">
            <h2 className="mb-2 flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-neutral-500">
              数据点 <span className="font-mono text-neutral-400">{points.length}</span>
            </h2>
            <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto font-mono text-xs">
              {points.slice().reverse().map((p) => (
                <li
                  key={p.id}
                  className="group flex cursor-pointer items-center justify-between rounded px-1.5 py-1 hover:bg-neutral-800"
                  onClick={() => deletePoint(p.id)}
                  title="点击删除此点"
                >
                  <span className="text-neutral-500 group-hover:text-red-400">#{p.id}</span>
                  <span>{graphText(p, kind)}</span>
                </li>
              ))}
              {!points.length && <li className="px-1.5 py-1 text-neutral-600">（空）</li>}
            </ul>
          </section>
        </aside>
      </div>

      {/* 状态栏 */}
      <footer className="flex items-center gap-4 border-t border-neutral-800 px-4 py-1.5 text-xs text-neutral-400">
        <span className="truncate">{status}</span>
        <span className="ml-auto shrink-0 text-neutral-600">
          滚轮缩放 · Alt 拖拽平移 · Ctrl+Z 撤销
        </span>
      </footer>
    </div>
  );
}
