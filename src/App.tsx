import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { APP_NAME, APP_VERSION } from "./app-meta";

interface CalibrationResult {
  x_per_pixel: number;
  y_per_pixel: number;
}

function App() {
  const [greetMsg, setGreetMsg] = useState("");
  const [name, setName] = useState("");
  const [calibMsg, setCalibMsg] = useState("");

  async function greet() {
    setGreetMsg(await invoke("greet", { name }));
  }

  // E2E 自检：调用 Rust 端 calibrate_linear 命令
  // 100px→0.0，500px→8.0 期望每像素 0.02
  async function runSelfTest() {
    try {
      const r = await invoke<CalibrationResult>("calibrate_linear", {
        p1Screen: 100,
        v1: 0,
        p2Screen: 500,
        v2: 8,
      });
      const ok = Math.abs(r.x_per_pixel - 0.02) < 1e-12;
      setCalibMsg(
        `${ok ? "✅ PASS" : "❌ FAIL"}: x_per_pixel = ${r.x_per_pixel}`,
      );
    } catch (e) {
      setCalibMsg(`❌ ERROR: ${e}`);
    }
  }

  return (
    <main className="flex h-screen flex-col items-center justify-center bg-neutral-950 text-neutral-100">
      <h1 className="mb-2 text-4xl font-bold tracking-tight">
        {APP_NAME} <span className="text-neutral-500">v{APP_VERSION}</span>
      </h1>
      <p className="mb-8 text-sm text-neutral-400">
        现代化的科研图表数字化工具 · XY / 极坐标 / 三元相图
      </p>

      <section className="flex flex-col items-center gap-3">
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            greet();
          }}
        >
          <input
            className="w-64 rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-sky-500"
            placeholder="输入名字试试 Rust 通道…"
            onChange={(e) => setName(e.target.value)}
          />
          <button
            type="submit"
            className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500"
          >
            Greet
          </button>
        </form>
        <p className="text-neutral-300">{greetMsg}</p>

        <button
          onClick={runSelfTest}
          className="mt-4 rounded-lg border border-emerald-600 px-4 py-2 text-sm font-medium text-emerald-400 hover:bg-emerald-950"
        >
          运行标定自检（前端 → Rust）
        </button>
        <p className="font-mono text-sm text-emerald-300">{calibMsg}</p>
      </section>
    </main>
  );
}

export default App;
