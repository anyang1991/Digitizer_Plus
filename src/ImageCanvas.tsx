// Digitizer Plus — 图像画布：缩放、平移、点击拾取（M1）
import { useEffect, useRef, useState, useCallback } from "react";
import type { ScreenPoint } from "./core";

interface Props {
  imageSrc: string | null;
  /** 点击回调：imageCoordinates 为图片原始像素坐标 */
  onImageClick: (img: ScreenPoint) => void;
  renderOverlay?: (
    ctx: CanvasRenderingContext2D,
    toScreen: (img: ScreenPoint) => ScreenPoint,
  ) => void;
  /** 视图（scale/pan）每次提交后回调（权威值，E2E/未来标尺用） */
  onViewState?: (v: { scale: number; pan: ScreenPoint }) => void;
}

const MIN_SCALE = 0.05;
const MAX_SCALE = 40;

/** 视口状态：图像坐标 → 画布坐标 = (img * scale) + pan */
export default function ImageCanvas({ imageSrc, onImageClick, renderOverlay, onViewState }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState<ScreenPoint>({ x: 0, y: 0 });
  const panDrag = useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(null);
  const [hoverImg, setHoverImg] = useState<ScreenPoint | null>(null);

  // 加载图片
  useEffect(() => {
    if (!imageSrc) {
      imgRef.current = null;
      return;
    }
    const img = new Image();
    img.onload = () => {
      imgRef.current = img;
      // 重置视图：适配窗口
      const wrap = wrapRef.current;
      if (wrap && img.width && img.height) {
        const s = Math.min(
          (wrap.clientWidth - 40) / img.width,
          (wrap.clientHeight - 40) / img.height,
          1,
        );
        setScale(s);
        setPan({
          x: (wrap.clientWidth - img.width * s) / 2,
          y: (wrap.clientHeight - img.height * s) / 2,
        });
      }
    };
    img.src = imageSrc;
  }, [imageSrc]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    // 上报视图参数（权威值：与绘制同帧的 scale/pan）
    onViewState?.({ scale, pan });
    const dpr = window.devicePixelRatio || 1;
    const w = wrap.clientWidth;
    const h = wrap.clientHeight;
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#0a0a0a";
    ctx.fillRect(0, 0, w, h);

    const toScreen = (p: ScreenPoint): ScreenPoint => ({
      x: p.x * scale + pan.x,
      y: p.y * scale + pan.y,
    });

    if (imgRef.current) {
      ctx.imageSmoothingEnabled = scale < 3;
      ctx.drawImage(
        imgRef.current,
        pan.x,
        pan.y,
        imgRef.current.width * scale,
        imgRef.current.height * scale,
      );
    }
    renderOverlay?.(ctx, toScreen);
  }, [scale, pan, renderOverlay]);

  useEffect(() => {
    draw();
  }, [draw, onViewState]);

  // 窗口尺寸变化重绘
  useEffect(() => {
    const ro = new ResizeObserver(() => draw());
    if (wrapRef.current) ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, [draw]);

  const screenToImage = (clientX: number, clientY: number): ScreenPoint => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: (clientX - rect.left - pan.x) / scale,
      y: (clientY - rect.top - pan.y) / scale,
    };
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale * factor));
    if (newScale === scale) return;
    // 以鼠标位置为锚点缩放：scale 与 pan 必须同帧更新，
    // 否则短暂出现"新 scale + 旧 pan"的中间态，点击换算会抖动
    setPan({
      x: mx - ((mx - pan.x) * newScale) / scale,
      y: my - ((my - pan.y) * newScale) / scale,
    });
    setScale(newScale);
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button === 1 || e.button === 2 || e.altKey || e.shiftKey) {
      // 中键/右键/Alt/Shift 拖拽平移
      panDrag.current = { startX: e.clientX, startY: e.clientY, panX: pan.x, panY: pan.y };
      e.preventDefault();
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    setHoverImg(screenToImage(e.clientX, e.clientY));
    if (panDrag.current) {
      setPan({
        x: panDrag.current.panX + (e.clientX - panDrag.current.startX),
        y: panDrag.current.panY + (e.clientY - panDrag.current.startY),
      });
    }
  };

  const endPan = () => {
    panDrag.current = null;
  };

  const handleClick = (e: React.MouseEvent) => {
    if (panDrag.current) return;
    onImageClick(screenToImage(e.clientX, e.clientY));
  };

  return (
    <div ref={wrapRef} className="relative h-full w-full overflow-hidden">
      <canvas
        ref={canvasRef}
        className={
          "block " + (imageSrc ? "cursor-crosshair" : "cursor-default")
        }
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={endPan}
        onMouseLeave={() => {
          endPan();
          setHoverImg(null);
        }}
        onClick={handleClick}
        onContextMenu={(e) => e.preventDefault()}
      />
      {imageSrc && (
        <div className="pointer-events-none absolute bottom-3 left-3 rounded bg-black/70 px-2.5 py-1 font-mono text-xs text-neutral-300">
          {hoverImg
            ? `px (${Math.round(hoverImg.x)}, ${Math.round(hoverImg.y)}) · 缩放 ${(scale * 100).toFixed(0)}%`
            : `缩放 ${(scale * 100).toFixed(0)}%`}
        </div>
      )}
      {!imageSrc && (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3 text-neutral-500">
          <div className="text-6xl">📈</div>
          <p className="text-lg">拖入图表图片，或点击「导入图片」</p>
          <p className="text-xs">支持 PNG · JPEG · BMP · GIF · WebP · TIFF</p>
        </div>
      )}
    </div>
  );
}
