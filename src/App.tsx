import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { APP_NAME, APP_VERSION } from "./app-meta";

function App() {
  const [greetMsg, setGreetMsg] = useState("");
  const [name, setName] = useState("");

  async function greet() {
    setGreetMsg(await invoke("greet", { name }));
  }

  return (
    <main className="flex h-screen flex-col items-center justify-center bg-neutral-950 text-neutral-100">
      <h1 className="mb-2 text-4xl font-bold tracking-tight">
        {APP_NAME} <span className="text-neutral-500">v{APP_VERSION}</span>
      </h1>
      <p className="mb-8 text-sm text-neutral-400">
        现代化的科研图表数字化工具 · XY / 极坐标 / 三元相图
      </p>
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
      <p className="mt-4 text-neutral-300">{greetMsg}</p>
    </main>
  );
}

export default App;
