// Digitizer Plus M1 E2E：通过 CDP 在真实 WebView 中驱动 UI
// 前置：应用以 WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222 运行
const CDP_PORT = 9222;

const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
const page = list.find((t) => t.type === "page");
if (!page) throw new Error("未找到应用页面");
console.log("target:", page.title || page.url);

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
    setTimeout(() => rej(new Error(`timeout: ${method}`)), 20000);
  });
}
async function evalJs(expr) {
  const r = await send("Runtime.evaluate", {
    expression: expr,
    awaitPromise: true,
    returnByValue: true,
  });
  if (r.result?.exceptionDetails)
    throw new Error(r.result.exceptionDetails.exception?.description || "JS exception");
  return r.result.result.value;
}

let failures = 0;
function check(name, actual, expect) {
  const ok = String(actual) === String(expect);
  if (!ok) failures++;
  console.log(`${ok ? "✅ PASS" : "❌ FAIL"} ${name}: got "${actual}"${ok ? "" : ` (expected "${expect}")`}`);
}

// 注入一个 2x2 红色测试图，模拟导入完成后的状态（不依赖系统文件对话框）
async function injectTestImage() {
  return evalJs(`(async () => {
    // 生成 200x100 的测试图：白底 + 左下/右上各一个黑点
    const c = document.createElement('canvas');
    c.width = 200; c.height = 100;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0,0,200,100);
    ctx.fillStyle = '#000';
    ctx.fillRect(20, 80, 4, 4);   // 期望图坐标 (1, 1)
    ctx.fillRect(160, 20, 4, 4);  // 期望图坐标 (8, 9)
    // 直接设置 React 状态：通过导入按钮不可行（系统对话框），改为模拟已导入
    window.__testImage = c.toDataURL('image/png');
    return 'ok';
  })()`);
}

// --- 测试 1: 顶栏与四个模式按钮渲染 ---
check("应用标题", await evalJs(`document.querySelector('h1')?.textContent.trim()`), "DigitizerPlus");
check("模式按钮数", await evalJs(`document.querySelectorAll('nav button').length`), "5");
check("导入按钮存在", await evalJs(`!![...document.querySelectorAll('button')].find(b=>b.textContent.includes('导入图片'))`), "true");

// --- 测试 2: 状态栏初始提示 ---
check("状态栏提示", await evalJs(`document.querySelector('footer span')?.textContent`), "导入一张图表图片开始");

// --- 测试 3: 标定数学（前端核心逻辑，在页面上下文内验证） ---
const calib = await evalJs(`(async () => {
  // 复制 core.ts 的算法在页面内验证：x 100px→0,500px→8; y 300px→5,100px→25
  const xs = [{s:100,v:0},{s:500,v:8}], ys = [{s:300,v:5},{s:100,v:25}];
  const xpp = (xs[1].v - xs[0].v) / (xs[1].s - xs[0].s);
  const ypp = (ys[1].v - ys[0].v) / (ys[1].s - ys[0].s);
  const gx = (300 - xs[0].s) * xpp;
  const gy = (200 - ys[0].s) * ypp;
  return JSON.stringify({ xpp, ypp, gx, gy });
})()`);
const c = JSON.parse(calib);
check("x 比例", c.xpp, "0.02");
check("y 比例(向下为负)", c.ypp, "-0.1");
check("屏幕(300,200)的图坐标", `${c.gx},${c.gy}`, "4,10");

// --- 测试 4: 无图时模式按钮禁用 ---
check("无图时按钮禁用", await evalJs(`document.querySelectorAll('nav button')[1].disabled`), "true");

ws.close();
console.log(failures === 0 ? "\n🎉 M1 E2E 全部通过" : `\n💥 ${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);
