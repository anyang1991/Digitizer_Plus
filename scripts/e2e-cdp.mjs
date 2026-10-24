// E2E 测试：通过 CDP 在 Digitizer Plus 的 WebView 内触发真实 UI 交互
// 用法: node scripts/e2e-cdp.mjs
const CDP_PORT = 9222;

const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
const page = list.find((t) => t.type === "page");
if (!page) throw new Error("未找到应用页面");
console.log("target:", page.title);

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let nextId = 1;
const pending = new Map();
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  }
};
function send(method, params = {}) {
  const id = nextId++;
  return new Promise((res, rej) => {
    pending.set(id, res);
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => rej(new Error(`timeout: ${method}`)), 15000);
  });
}
async function evalJs(expr) {
  const r = await send("Runtime.evaluate", {
    expression: expr,
    awaitPromise: true,
    returnByValue: true,
  });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
  return r.result.result.value;
}

let failures = 0;
function check(name, actual, expect) {
  const ok = String(actual) === String(expect);
  if (!ok) failures++;
  console.log(`${ok ? "✅ PASS" : "❌ FAIL"} ${name}: got "${actual}"${ok ? "" : ` (expected "${expect}")`}`);
}

// --- 测试 1: 应用标题渲染 ---
check("标题", await evalJs(`document.querySelector('h1')?.textContent.trim()`),
  "Digitizer Plus v0.1.0");

// --- 测试 2: Greet 按钮 → 前端到 Rust 往返 ---
await evalJs(`(async () => {
  const input = document.querySelector('input');
  const setVal = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setVal.call(input, 'E2E');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  document.querySelectorAll('button')[0].click();
  await new Promise(r => setTimeout(r, 800));
})()`);
check("greet 往返", await evalJs(`[...document.querySelectorAll('p')].map(p=>p.textContent).find(t=>t.includes('Hello'))`),
  "Hello, E2E! Digitizer Plus core is alive.");

// --- 测试 3: 标定自检按钮 → calibrate_linear 命令 ---
await evalJs(`(async () => {
  document.querySelectorAll('button')[1].click();
  await new Promise(r => setTimeout(r, 800));
})()`);
check("标定自检", await evalJs(`[...document.querySelectorAll('p')].map(p=>p.textContent).find(t=>t.includes('x_per_pixel'))`),
  "✅ PASS: x_per_pixel = 0.02");

ws.close();
console.log(failures === 0 ? "\n🎉 全部通过" : `\n💥 ${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);
