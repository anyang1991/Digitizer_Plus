// Digitizer Plus — 主界面（M1）：导入图片 → 标定 → 取点 → 导出
// 设计理念受 Engauge Digitizer 启发（详见 app-meta.ts），实现为独立原创。

import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import ImageCanvas from "./ImageCanvas";
import {
  computeCalibration,
  fmt,
  nextId,
  screenToGraph,
  toCsv,
  type AxisPoint,
  type DigitizedPoint,
  type DigitizeMode,
  type ImageInfo,
  type ScreenPoint,
} from "./core";

const MODES: { key: DigitizeMode; label: string; hint: string; hotkey: string }[] = [
  { key: "select", label: "选择", hint: "浏览图像（Alt/右键拖拽平移，滚轮缩放）", hotkey: "V" },
  { key: "axis-x", label: "X 轴点", hint: "在 X 轴上点击两个已知刻度点", hotkey: "X" },
  { key: "axis-y", label: "Y 轴点", hint: "在 Y 轴上点击两个已知刻度点", hotkey: "Y" },
  { key: "curve-point", label: "取点", hint: "沿曲线点击添加数据点", hotkey: "P" },
];

export default function App() {
  const [image, setImage] = useState<ImageInfo | null>(null);
  const [mode, setMode] = useState<DigitizeMode>("select");
  const [axisPoints, setAxisPoints] = useState<AxisPoint[]>([]);
  const [points, setPoints] = useState<DigitizedPoint[]>([]);
  const [pendingAxis, setPendingAxis] = useState<{ axis: "x" | "y"; screen: ScreenPoint } | null>(null);
  const [axisInput, setAxisInput] = useState("");
  const [status, setStatus] = useState("导入一张图表图片开始");

  const cal = useMemo(() => computeCalibration(axisPoints), [axisPoints]);

  // 标定变化时重算所有点的图坐标
  const recomputeGraphs = useCallback(
    (pts: DigitizedPoint[], c: typeof cal) => {
      if (!c || (!c.xDefined && !c.yDefined)) return pts.map((p) => ({ ...p, graph: null }));
      return pts.map((p) => ({ ...p, graph: screenToGraph(p.screen, c) }));
    },
    [],
  );

  const handleImport = async () => {
    try {
      const img = await invoke<ImageInfo>("import_image");
      setImage(img);
      setAxisPoints([]);
      setPoints([]);
      setPendingAxis(null);
      setStatus(`已导入 ${img.name} (${img.width}×${img.height}) — 先用 X/Y 轴点标定坐标`);
    } catch (e) {
      if (String(e).includes("未选择")) return;
      setStatus(`导入失败: ${e}`);
    }
  };

  const handleExport = async () => {
    const csv = toCsv(points);
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

  const handleImageClick = (img: ScreenPoint) => {
    if (!image) return;
    if (mode === "axis-x" || mode === "axis-y") {
      setPendingAxis({ axis: mode === "axis-x" ? "x" : "y", screen: img });
      setAxisInput("");
      return;
    }
    if (mode === "curve-point") {
      const p: DigitizedPoint = { id: nextId(), screen: img, graph: null };
      setPoints((prev) => recomputeGraphs([...prev, p], cal));
      const n = points.length + 1;
      setStatus(
        cal?.xDefined || cal?.yDefined
          ? `已添加第 ${n} 个数据点`
          : `已添加第 ${n} 个数据点（当前为像素坐标，完成标定后自动换算）`,
      );
    }
  };

  // 右键删除最近的数据点（在数据列表上时删除指定点）
  const deletePoint = (id: number) => {
    setPoints((prev) => prev.filter((p) => p.id !== id));
  };

  // 提交轴点坐标值
  const submitAxisValue = () => {
    if (!pendingAxis) return;
    const v = parseFloat(axisInput);
    if (!Number.isFinite(v)) {
      setStatus("请输入有效的数值");
      return;
    }
    const ap: AxisPoint = {
      id: nextId(),
      screen: pendingAxis.screen,
      value: v,
      axis: pendingAxis.axis,
    };
    const next = [...axisPoints, ap];
    setAxisPoints(next);
    const nextCal = computeCalibration(next);
    setPoints((prev) => recomputeGraphs(prev, nextCal));
    setPendingAxis(null);

    const xCount = next.filter((p) => p.axis === "x").length;
    const yCount = next.filter((p) => p.axis === "y").length;
    if (nextCal?.xDefined && nextCal?.yDefined) {
      setStatus("✅ 标定完成！切换到「取点」模式沿曲线添加数据点");
    } else if (pendingAxis.axis === "x") {
      setStatus(`X 轴点 ${xCount}/2 — ${nextCal?.xDefined ? "已定义" : "还需 1 个"}`);
    } else {
      setStatus(`Y 轴点 ${yCount}/2 — ${nextCal?.yDefined ? "已定义" : "还需 1 个"}`);
    }
  };

  const undoLast = () => {
    if (pendingAxis) {
      setPendingAxis(null);
      return;
    }
    if (points.length) {
      setPoints((prev) => prev.slice(0, -1));
      return;
    }
    if (axisPoints.length) {
      const next = axisPoints.slice(0, -1);
      setAxisPoints(next);
      const c = computeCalibration(next);
      setPoints((prev) => recomputeGraphs(prev, c));
    }
  };

  // 拖拽导入图片
  const [dragOver, setDragOver] = useState(false);
  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    try {
      // Web 端读取文件字节，经 Rust 校验解码并返回统一 ImagePayload
      const buf = await file.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let bin = "";
      const chunk = 0x8000;
      for (let i = 0; i < bytes.length; i += chunk) {
        bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
      }
      const payload = await invoke<ImageInfo>("validate_image", {
        name: file.name,
        mime: file.type || "image/png",
        dataBase64: btoa(bin),
      });
      setImage(payload);
      setAxisPoints([]);
      setPoints([]);
      setPendingAxis(null);
      setStatus(`已导入 ${payload.name} (${payload.width}×${payload.height}) — 先用 X/Y 轴点标定坐标`);
    } catch (err) {
      setStatus(`导入失败: ${err}`);
    }
  };

  // 键盘快捷键
  const onKey = (e: React.KeyboardEvent) => {    if (pendingAxis && (e.key === "Enter" || e.key === "Escape")) {
      if (e.key === "Enter") submitAxisValue();
      else setPendingAxis(null);
      return;
    }
    const k = e.key.toLowerCase();
    if (k === "v") setMode("select");
    else if (k === "x") setMode("axis-x");
    else if (k === "y") setMode("axis-y");
    else if (k === "p") setMode("curve-point");
    else if ((e.ctrlKey || e.metaKey) && k === "z") {
      e.preventDefault();
      undoLast();
    }
  };

  // E2E 测试钩子（仅开发模式暴露）
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    (window as never as Record<string, unknown>).__DIGITIZER_E2E__ = {
      // 直接注入已导入的图片状态
      loadImage(info: ImageInfo) {
        setImage(info);
        setAxisPoints([]);
        setPoints([]);
        setPendingAxis(null);
      },
      // 模拟用户在图像坐标处点击（走与真实点击完全相同的 handleImageClick 逻辑）
      simulateClick(imgX: number, imgY: number) {
        handleImageClick({ x: imgX, y: imgY });
      },
      // 读取当前应用状态
      getState() {
        const c = computeCalibration(axisPoints);
        return {
          xDefined: c?.xDefined ?? false,
          yDefined: c?.yDefined ?? false,
          points,
          status,
          csv: toCsv(points),
        };
      },
    };
  });

  // Canvas 叠加层：绘制标定点与数据点
  const renderOverlay = useCallback(
    (ctx: CanvasRenderingContext2D, toScreen: (p: ScreenPoint) => ScreenPoint) => {
      // 轴点：空心方块（x 轴橙 / y 轴青）
      for (const ap of axisPoints) {
        const s = toScreen(ap.screen);
        ctx.strokeStyle = ap.axis === "x" ? "#fb923c" : "#22d3ee";
        ctx.lineWidth = 2;
        ctx.strokeRect(s.x - 6, s.y - 6, 12, 12);
        ctx.fillStyle = ctx.strokeStyle;
        ctx.font = "12px ui-monospace, monospace";
        ctx.fillText(String(ap.value), s.x + 10, s.y - 10);
      }
      // 数据点：实心红点
      ctx.fillStyle = "#ef4444";
      for (const p of points) {
        const s = toScreen(p.screen);
        ctx.beginPath();
        ctx.arc(s.x, s.y, 4, 0, Math.PI * 2);
        ctx.fill();
      }
    },
    [axisPoints, points],
  );

  const xDefined = cal?.xDefined ?? false;
  const yDefined = cal?.yDefined ?? false;

  return (
    <div
      className={"flex h-screen flex-col bg-neutral-950 text-neutral-100 " + (dragOver ? "ring-2 ring-inset ring-sky-500" : "")}
      onKeyDown={onKey}
      tabIndex={-1}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragOver(false);
      }}
      onDrop={handleDrop}
    >
      {/* 顶栏 */}
      <header className="flex items-center gap-3 border-b border-neutral-800 px-4 py-2.5">
        <h1 className="text-base font-bold tracking-tight">
          Digitizer<span className="text-sky-500">Plus</span>
        </h1>
        <button
          onClick={handleImport}
          className="rounded-md bg-sky-600 px-3 py-1.5 text-sm font-medium hover:bg-sky-500"
        >
          导入图片
        </button>
        <button
          onClick={handleExport}
          disabled={!points.some((p) => p.graph)}
          className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
        >
          导出 CSV
        </button>
        <div className="ml-auto text-xs text-neutral-500">Win · macOS · Linux</div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* 左侧工具栏 */}
        <nav className="flex w-32 flex-col gap-1 border-r border-neutral-800 p-2">
          {MODES.map((m) => (
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
          />
          {/* 轴点数值输入浮层 */}
          {pendingAxis && (
            <div className="absolute left-1/2 top-4 w-72 -translate-x-1/2 rounded-lg border border-neutral-700 bg-neutral-900 p-3 shadow-xl">
              <p className="mb-2 text-sm">
                {pendingAxis.axis === "x" ? "X" : "Y"} 轴点坐标值：
              </p>
              <div className="flex gap-2">
                <input
                  autoFocus
                  value={axisInput}
                  onChange={(e) => setAxisInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") submitAxisValue();
                    if (e.key === "Escape") setPendingAxis(null);
                  }}
                  placeholder={pendingAxis.axis === "x" ? "如 0、10、100…" : "如 5、20…"}
                  className="min-w-0 flex-1 rounded border border-neutral-700 bg-neutral-800 px-2 py-1.5 font-mono text-sm outline-none focus:border-sky-500"
                />
                <button
                  onClick={submitAxisValue}
                  className="rounded bg-sky-600 px-3 py-1.5 text-sm hover:bg-sky-500"
                >
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
            <div className="space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-orange-400">X 轴</span>
                <span>{xDefined ? `✅ (${axisPoints.filter((p) => p.axis === "x").length} 点)` : "未定义"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-cyan-400">Y 轴</span>
                <span>{yDefined ? `✅ (${axisPoints.filter((p) => p.axis === "y").length} 点)` : "未定义"}</span>
              </div>
              {cal?.xDefined && (
                <div className="pt-1 font-mono text-xs text-neutral-500">
                  x: {fmt(cal.xPerPixel)}/px · y: {fmt(cal.yPerPixel)}/px
                </div>
              )}
            </div>
          </section>
          <section className="flex min-h-0 flex-1 flex-col p-3">
            <h2 className="mb-2 flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-neutral-500">
              数据点 <span className="font-mono text-neutral-400">{points.length}</span>
            </h2>
            <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto font-mono text-xs">
              {points
                .slice()
                .reverse()
                .map((p) => (
                  <li
                    key={p.id}
                    className="group flex cursor-pointer items-center justify-between rounded px-1.5 py-1 hover:bg-neutral-800"
                    onClick={() => deletePoint(p.id)}
                    title="点击删除此点"
                  >
                    <span className="text-neutral-500 group-hover:text-red-400">#{p.id}</span>
                    <span>
                      {p.graph ? `${fmt(p.graph.x)}, ${fmt(p.graph.y)}` : "px (未标定)"}
                    </span>
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
          V/X/Y/P 切换模式 · Ctrl+Z 撤销 · 滚轮缩放 · Alt 拖拽平移
        </span>
      </footer>
    </div>
  );
}
