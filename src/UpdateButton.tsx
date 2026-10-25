// 更新检查按钮：静默检查 GitHub Releases，有更新时高亮，点击下载安装并重启
import { useCallback, useEffect, useRef, useState } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

type UpdateState =
  | { phase: "idle" }
  | { phase: "checking" }
  | { phase: "available"; update: Update; version: string; notes?: string }
  | { phase: "downloading"; progress: number; total?: number }
  | { phase: "installing" }
  | { phase: "error"; message: string }
  | { phase: "uptodate" };

export default function UpdateButton() {
  const [state, setState] = useState<UpdateState>({ phase: "idle" });
  const checkedOnce = useRef(false);

  const doCheck = useCallback(async (silent: boolean) => {
    setState({ phase: "checking" });
    try {
      const update = await check();
      if (update) {
        setState({
          phase: "available",
          update,
          version: update.version,
          notes: update.body?.slice(0, 200),
        });
      } else {
        setState({ phase: "uptodate" });
        if (silent) {
          // 静默检查无更新时不打扰：短暂显示后回到 idle
          setTimeout(() => setState({ phase: "idle" }), 2500);
        }
      }
    } catch (e) {
      // 静默模式下的失败（如离线）不打扰用户
      if (!silent) {
        setState({ phase: "error", message: String(e).slice(0, 120) });
      } else {
        setState({ phase: "idle" });
      }
    }
  }, []);

  // 启动 3 秒后静默检查一次
  useEffect(() => {
    if (checkedOnce.current) return;
    checkedOnce.current = true;
    const t = setTimeout(() => doCheck(true), 3000);
    return () => clearTimeout(t);
  }, [doCheck]);

  const doInstall = useCallback(async (update: Update) => {
    setState({ phase: "downloading", progress: 0 });
    try {
      let received = 0;
      let total: number | undefined;
      await update.downloadAndInstall((event) => {
        switch (event.event) {
          case "Started":
            total = event.data.contentLength;
            break;
          case "Progress":
            received += event.data.chunkLength;
            setState({
              phase: "downloading",
              progress: total ? received / total : 0,
              total,
            });
            break;
          case "Finished":
            setState({ phase: "installing" });
            break;
        }
      });
      // 下载完成：重启进入新版本
      await relaunch();
    } catch (e) {
      setState({ phase: "error", message: String(e).slice(0, 120) });
    }
  }, []);

  const label = (() => {
    switch (state.phase) {
      case "idle":
        return "检查更新";
      case "checking":
        return "检查中…";
      case "uptodate":
        return "已是最新";
      case "available":
        return `⬆ 新版本 v${state.version} — 点击更新`;
      case "downloading":
        return `下载中 ${(state.progress * 100).toFixed(0)}%`;
      case "installing":
        return "安装中… 即将重启";
      case "error":
        return `更新失败：${state.message}`;
    }
  })();

  const style = (() => {
    switch (state.phase) {
      case "available":
        return "bg-emerald-600 text-white animate-pulse hover:bg-emerald-500";
      case "downloading":
        return "bg-emerald-700/50 text-emerald-300";
      case "checking":
        return "bg-neutral-800 text-neutral-400";
      case "uptodate":
        return "bg-neutral-800 text-neutral-500";
      case "error":
        return "bg-red-900/40 text-red-300";
      default:
        return "bg-neutral-800 text-neutral-300 hover:bg-neutral-700";
    }
  })();

  return (
    <button
      onClick={() => {
        if (state.phase === "available") doInstall(state.update);
        else if (state.phase === "idle" || state.phase === "uptodate" || state.phase === "error")
          doCheck(false);
      }}
      disabled={state.phase === "checking" || state.phase === "downloading" || state.phase === "installing"}
      className={"rounded-md px-3 py-1.5 text-sm transition-colors disabled:cursor-not-allowed " + style}
      title={state.phase === "available" && state.notes ? state.notes : undefined}
    >
      {label}
    </button>
  );
}
