// Digitizer Plus M1 全流程 E2E：在真实 WebView 中模拟用户完整操作
// 流程：注入测试图 → X 轴标定(2点) → Y 轴标定(2点) → 曲线取点(3点)
//       → 验证坐标换算 → 验证点删除 → 验证 CSV 内容
// 前置：应用以 WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222 运行
import zlib from "node:zlib";

const CDP_PORT = 9222;

/** 用 Node 内置 zlib 生成一张 400x300 的有效 PNG（白色，左下/右上各一个黑块） */
function makeTestPng() {
  const W = 400, H = 300;
  const raw = Buffer.alloc(H * (1 + W * 3));
  for (let y = 0; y < H; y++) {
    const row = y * (1 + W * 3);
    raw[row] = 0; // filter: none
    for (let x = 0; x < W; x++) {
      const off = row + 1 + x * 3;
      const dark =
        (x >= 18 && x < 26 && y >= H - 28 && y < H - 20) || // 左下黑块
        (x >= W - 26 && x < W - 18 && y >= 18 && y < 26); // 右上黑块
      raw[off] = raw[off + 1] = raw[off + 2] = dark ? 0 : 255;
    }
  }
  const crcTable = [...Array(256)].map((_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc32 = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
const page = list.find((t) => t.type === "page");
if (!page) throw new Error("未找到应用页面");
console.log("target:", page.url);

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
  console.log(`${ok ? "✅" : "❌"} ${name}: got "${actual}"${ok ? "" : ` (expected "${expect}")`}`);
}

// 通过调试钩子注入 Node 生成的测试图（400x300）
const png = makeTestPng();
const b64 = png.toString("base64");
await evalJs(`window.__pendingImage = {
  name: "e2e-test.png", mime: "image/png", width: 400, height: 300,
  dataBase64: "${b64}",
}`);
const injected = await evalJs(`(async () => {
  if (!window.__DIGITIZER_E2E__) return "hook-missing";
  window.__DIGITIZER_E2E__.loadImage(window.__pendingImage);
  await new Promise(r => setTimeout(r, 400));
  return "loaded";
})()`);
check("测试图注入", injected, "loaded");

// --- 1. X 轴标定：图像 (100,250)→0 与 (300,250)→10 ---
await evalJs(`(async () => {
  [...document.querySelectorAll('nav button')].find(b => b.textContent.includes('X 轴点')).click();
  await new Promise(r => setTimeout(r, 100));
})()`);
async function axisClickAndSubmit(imgX, imgY, value) {
  await evalJs(`(async () => {
    window.__DIGITIZER_E2E__.simulateClick(${imgX}, ${imgY});
    await new Promise(r => setTimeout(r, 120));
  })()`);
  await evalJs(`(async () => {
    const input = document.querySelector('main input');
    if (!input) throw new Error('轴值输入框未出现');
    const setVal = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setVal.call(input, '${value}');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 60));
    [...document.querySelectorAll('main button')].find(b => b.textContent === '确定').click();
    await new Promise(r => setTimeout(r, 120));
  })()`);
}
await axisClickAndSubmit(100, 250, "0");
await axisClickAndSubmit(300, 250, "10");
check("X 轴已标定", await evalJs(`window.__DIGITIZER_E2E__.getState().xDefined`), "true");

// --- 2. Y 轴标定：图像 (100,250)→0 与 (100,50)→20 ---
await evalJs(`(async () => {
  [...document.querySelectorAll('nav button')].find(b => b.textContent.includes('Y 轴点')).click();
  await new Promise(r => setTimeout(r, 100));
})()`);
await axisClickAndSubmit(100, 250, "0");
await axisClickAndSubmit(100, 50, "20");
const st1 = await evalJs(`JSON.stringify(window.__DIGITIZER_E2E__.getState())`);
check("Y 轴已标定", JSON.parse(st1).yDefined, "true");
check("标定完成提示", JSON.parse(st1).status.includes("标定完成"), "true");

// --- 3. 取点：图像 (150,150) (200,100) (250,150) ---
await evalJs(`(async () => {
  [...document.querySelectorAll('nav button')].find(b => b.textContent.includes('取点')).click();
  await new Promise(r => setTimeout(r, 100));
})()`);
for (const [px, py] of [[150, 150], [200, 100], [250, 150]]) {
  await evalJs(`(async () => {
    window.__DIGITIZER_E2E__.simulateClick(${px}, ${py});
    await new Promise(r => setTimeout(r, 100));
  })()`);
}
check("取点数量", await evalJs(`window.__DIGITIZER_E2E__.getState().points.length`), "3");
// 换算：x=(imgX-100)*0.05; y=(imgY-250)*(-0.1)
// 点(200,100): x=5, y=(-150)*(-0.1)=15
check("坐标换算", await evalJs(`window.__DIGITIZER_E2E__.getState().points.map(p => p.graph.x + "," + p.graph.y).join(" | ")`), "2.5,10 | 5,15 | 7.5,10");

// --- 4. 列表点击删除最新点 ---
await evalJs(`(async () => {
  document.querySelector('aside ul li').click();
  await new Promise(r => setTimeout(r, 100));
})()`);
check("删除后数量", await evalJs(`window.__DIGITIZER_E2E__.getState().points.length`), "2");

// --- 5. CSV 内容 ---
check("CSV 内容", await evalJs(`window.__DIGITIZER_E2E__.getState().csv`), "x,y\n2.5,10\n5,15\n");

ws.close();
console.log(failures === 0 ? "\n🎉 全流程 E2E 通过" : `\n💥 ${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);
