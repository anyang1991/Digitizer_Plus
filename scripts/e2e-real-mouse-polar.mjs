// 真实鼠标事件流 E2E：不借助 __DIGITIZER_E2E__ 钩子的 simulateClick，
// 而是通过 CDP Input.dispatchMouseEvent 在窗口坐标注入真实鼠标事件，
// 验证 Canvas 命中检测（含缩放/平移变换）在多类型 UI 下工作正常。
// 前置：应用运行且 CDP 9222 可用。测试图 400x300，默认 1:1 显示。
import zlib from "node:zlib";

const list = await (await fetch("http://127.0.0.1:9222/json/list")).json();
const page = list.find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let nextId = 1;
const pendingMap = new Map();
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pendingMap.has(msg.id)) { pendingMap.get(msg.id)(msg); pendingMap.delete(msg.id); }
};
function send(method, params = {}) {
  const id = nextId++;
  return new Promise((res, rej) => {
    pendingMap.set(id, res);
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => rej(new Error(`timeout: ${method}`)), 20000);
  });
}
async function evalJs(expr) {
  const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || "JS exception");
  return r.result.result.value;
}

/* ---- 注入极坐标测试图（圆心 200,150；R 点 300,150 r=10；θ 点 200,50 θ=90）---- */
function makePng(w, h, raw) {
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
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0)),
  ]);
}
const W = 400, H = 300;
const raw = Buffer.alloc(H * (1 + W * 3));
const px = (x, y, v) => {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const o = y * (1 + W * 3) + 1 + x * 3;
  raw[o] = v; raw[o + 1] = v; raw[o + 2] = v;
};
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) px(x, y, 255);

// ---- 加载与几何探测 ----
await evalJs(`window.__img = {
  name: "polar-mouse.png", mime: "image/png", width: ${W}, height: ${H},
  dataBase64: "${makePng(W, H, raw).toString("base64")}",
}`);
await evalJs(`(async () => {
  window.__DIGITIZER_E2E__.loadImage(window.__img);
  await new Promise(r => setTimeout(r, 500));
})()`);

// 通过 getBoundingClientRect 找 canvas 与图像 1:1 映射
const geom = await evalJs(`(() => {
  const c = document.querySelector('canvas');
  const r = c.getBoundingClientRect();
  const scale = window.devicePixelRatio || 1;
  return { left: r.left, top: r.top, cssW: r.width, cssH: r.height, scale };
})()`);
console.log("canvas 几何:", JSON.stringify(geom));

// 视图初始为 contain 适配：显示比例 = min(cssW/W, cssH/H)，居中有偏移
const fitScale = Math.min(geom.cssW / W, geom.cssH / H);
const offX = (geom.cssW - W * fitScale) / 2;
const offY = (geom.cssH - H * fitScale) / 2;
console.log(`contain: scale=${fitScale.toFixed(3)} offset=(${offX},${offY})`);
const toWindow = (ix, iy) => ({
  wx: geom.left + offX + ix * fitScale,
  wy: geom.top + offY + iy * fitScale,
});

async function mouseClick(ix, iy) {
  const { wx, wy } = toWindow(ix, iy);
  for (const type of ["mousePressed", "mouseReleased"]) {
    await send("Input.dispatchMouseEvent", {
      type, x: wx, y: wy, button: "left", clickCount: 1,
    });
    await new Promise((r) => setTimeout(r, 60));
  }
  await new Promise((r) => setTimeout(r, 120));
}

let failures = 0;
const check = (name, actual, expect) => {
  const ok = String(actual) === String(expect);
  if (!ok) failures++;
  console.log(`${ok ? "✅" : "❌"} ${name}: got "${actual}"${ok ? "" : ` (expected "${expect}")`}`);
};

/* ---- 极坐标全流程（真实鼠标） ---- */
await evalJs(`window.__DIGITIZER_E2E__.setChartType("polar")`);
await new Promise((r) => setTimeout(r, 300));
await evalJs(`window.__DIGITIZER_E2E__.setMode("polar")`);
await new Promise((r) => setTimeout(r, 200));

await mouseClick(200, 150); // O：无弹窗
await new Promise((r) => setTimeout(r, 100));
await mouseClick(300, 150); // R 点 → 弹窗
let s = JSON.parse(await evalJs(`JSON.stringify(window.__DIGITIZER_E2E__.getState())`));
check("真实鼠标-O 已注册", s.polarStep >= 1, "true");
const hasInput = await evalJs(`document.querySelector("main input") !== null`);
check("真实鼠标-弹窗出现", hasInput ? "yes" : "no", "yes");

// 输入 R 值
await evalJs(`(async () => {
  const input = document.querySelector('main input');
  const setVal = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setVal.call(input, '10');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise(r => setTimeout(r, 60));
  [...document.querySelectorAll('main button')].find(b => b.textContent === '确定').click();
  await new Promise(r => setTimeout(r, 120));
})()`);
await mouseClick(200, 50); // θ 点 → 弹窗
await evalJs(`(async () => {
  const input = document.querySelector('main input');
  const setVal = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setVal.call(input, '90');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise(r => setTimeout(r, 60));
  [...document.querySelectorAll('main button')].find(b => b.textContent === '确定').click();
  await new Promise(r => setTimeout(r, 120));
})()`);
s = JSON.parse(await evalJs(`JSON.stringify(window.__DIGITIZER_E2E__.getState())`));
check("真实鼠标-极坐标标定", s.polarDefined, "true");

// 切取点模式，真实鼠标点击 (235,115)（右上 45°方向 r=4.95px*0.1）
await evalJs(`window.__DIGITIZER_E2E__.setMode("curve-point")`);
await new Promise((r) => setTimeout(r, 200));
await mouseClick(235, 115);
s = JSON.parse(await evalJs(`JSON.stringify(window.__DIGITIZER_E2E__.getState())`));
const theta = s.points[0]?.graph?.x, r = s.points[0]?.graph?.y;
const ok = Math.abs(theta - 45) < 0.5 && Math.abs(r - 4.95) < 0.06;
if (!ok) failures++;
console.log(`${ok ? "✅" : "❌"} 真实鼠标取点换算: θ=${theta?.toFixed(2)}° r=${r?.toFixed(3)} 期望 (45°, 4.95)`);

console.log(failures === 0 ? "\n🎉 真实鼠标事件流 E2E 通过" : `\n💥 ${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);
