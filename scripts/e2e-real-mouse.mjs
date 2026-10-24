// 真实鼠标事件路径 E2E：不经过任何钩子直调，完全走
// DOM mousedown/mousemove/mouseup/wheel → ImageCanvas 坐标换算 → handleImageClick。
// 验证昨晚盲区：屏幕坐标 ↔ 图像坐标的真实换算链路。
import zlib from "node:zlib";

const CDP_PORT = 9222;

function makeTestPng() {
  const W = 400, H = 300;
  const raw = Buffer.alloc(H * (1 + W * 3));
  for (let y = 0; y < H; y++) {
    const row = y * (1 + W * 3);
    raw[row] = 0;
    for (let x = 0; x < W; x++) {
      const off = row + 1 + x * 3;
      const dark =
        (x >= 18 && x < 26 && y >= H - 28 && y < H - 20) ||
        (x >= W - 26 && x < W - 18 && y >= 18 && y < 26);
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
  ihdr[8] = 8;
  ihdr[9] = 2;
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

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let nextId = 1;
const pending = new Map();
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
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
  const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
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

// 注入图片（复用调试钩子，仅注入；点击全部走真实 DOM 事件）
const png = makeTestPng();
await evalJs(`window.__pendingImage = {
  name: "e2e-test.png", mime: "image/png", width: 400, height: 300,
  dataBase64: "${png.toString("base64")}",
}`);
await evalJs(`(async () => {
  window.__DIGITIZER_E2E__.loadImage(window.__pendingImage);
  await new Promise(r => setTimeout(r, 400));
})()`);

// 获取画布的真实屏幕位置与视图参数（fit 后的 scale/pan 由应用内部计算）
const view = JSON.parse(await evalJs(`(async () => {
  const canvas = document.querySelector('main canvas');
  const rect = canvas.getBoundingClientRect();
  return JSON.stringify({
    left: rect.left, top: rect.top,
    // 从 ImageCanvas 底部提示条读出缩放百分比
    zoomText: document.querySelector('main .pointer-events-none.absolute.bottom-3')?.textContent,
  });
})()`));
console.log("画布视图:", JSON.stringify(view));

// 等待视图参数稳定（连续两次读数一致），避免读到缩放过渡中的中间态
async function waitViewSettle() {
  const read = async () => JSON.parse(await evalJs(`JSON.stringify(window.__DIGITIZER_E2E__.getView())`));
  let prev = JSON.stringify(await read());
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 150));
    const cur = await read();
    if (JSON.stringify(cur) === prev) return cur;
    prev = JSON.stringify(cur);
  }
  throw new Error("视图参数未稳定");
}

/**
 * 真实鼠标点击：读视图、算坐标、派发事件全部在页面内一次原子求值中完成。
 * 屏幕坐标取整（与真实硬件鼠标一致——SendInput 传入的就是整数像素），
 * 避免 Chromium 对合成事件坐标取整引入的 0.5px 伪差。
 */
async function realMouseClickAtImage(imgX, imgY) {
  await evalJs(`(async () => {
    // 等视图稳定
    let prev = JSON.stringify(window.__DIGITIZER_E2E__.getView());
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 100));
      const cur = JSON.stringify(window.__DIGITIZER_E2E__.getView());
      if (cur === prev) break;
      prev = cur;
    }
    const vp = window.__DIGITIZER_E2E__.getView();
    const rect = document.querySelector('main canvas').getBoundingClientRect();
    const screenX = Math.round(rect.left + ${imgX} * vp.scale + vp.pan.x);
    const screenY = Math.round(rect.top + ${imgY} * vp.scale + vp.pan.y);
    const opts = { clientX: screenX, clientY: screenY, button: 0, bubbles: true, cancelable: true };
    const canvas = document.querySelector('main canvas');
    canvas.dispatchEvent(new MouseEvent('mousedown', opts));
    canvas.dispatchEvent(new MouseEvent('mouseup', opts));
    canvas.dispatchEvent(new MouseEvent('click', opts));
    await new Promise(r => setTimeout(r, 120));
  })()`);
}

/** 容差比较：取整后误差 ≤ 0.5 屏幕像素 / scale（图像像素） */
async function checkPoint(name, idx, ex, ey, scale) {
  const got = await evalJs(`(() => {
    const p = window.__DIGITIZER_E2E__.getState().points[${idx}];
    return p && p.graph ? p.graph.x + "," + p.graph.y : "none";
  })()`);
  const [gx, gy] = got.split(",").map(Number);
  const tol = 0.6 / scale;
  const ok = Math.abs(gx - ex) <= tol && Math.abs(gy - ey) <= tol;
  if (!ok) failures++;
  console.log(`${ok ? "✅" : "❌"} ${name}: got "${got}" (expected ~${ex},${ey} ±${tol.toFixed(3)})`);
}

// --- X 轴标定（真实鼠标事件） ---
await evalJs(`(async () => {
  [...document.querySelectorAll('nav button')].find(b => b.textContent.includes('X 轴点')).click();
  await new Promise(r => setTimeout(r, 100));
})()`);
async function submitAxis(value) {
  await evalJs(`(async () => {
    const input = document.querySelector('main input');
    const setVal = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setVal.call(input, '${value}');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 50));
    [...document.querySelectorAll('main button')].find(b => b.textContent === '确定').click();
    await new Promise(r => setTimeout(r, 100));
  })()`);
}
await realMouseClickAtImage(100, 250);
await submitAxis("0");
await realMouseClickAtImage(300, 250);
await submitAxis("10");
check("真实鼠标 X 标定", await evalJs(`window.__DIGITIZER_E2E__.getState().xDefined`), "true");

// --- Y 轴 ---
await evalJs(`(async () => {
  [...document.querySelectorAll('nav button')].find(b => b.textContent.includes('Y 轴点')).click();
  await new Promise(r => setTimeout(r, 100));
})()`);
await realMouseClickAtImage(100, 250); await submitAxis("0");
await realMouseClickAtImage(100, 50); await submitAxis("20");
check("真实鼠标 Y 标定", await evalJs(`window.__DIGITIZER_E2E__.getState().yDefined`), "true");

// --- 真实鼠标取点 + 坐标换算闭环 ---
await evalJs(`(async () => {
  [...document.querySelectorAll('nav button')].find(b => b.textContent.includes('取点')).click();
  await new Promise(r => setTimeout(r, 100));
})()`);
await realMouseClickAtImage(250, 150);
// 期望：x=(250-100)*0.05=7.5, y=(150-250)*(-0.1)=10
const vp1 = JSON.parse(await evalJs(`JSON.stringify(window.__DIGITIZER_E2E__.getView())`));
await checkPoint("真实鼠标取点坐标", 0, 7.5, 10, vp1.scale);

// --- 滚轮缩放后坐标不变性（真实 WheelEvent + 整数点击 + 容差） ---
await evalJs(`(async () => {
  const canvas = document.querySelector('main canvas');
  const r = canvas.getBoundingClientRect();
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  canvas.dispatchEvent(new WheelEvent('wheel', { clientX: cx, clientY: cy, deltaY: -240, bubbles: true, cancelable: true }));
  await new Promise(r2 => setTimeout(r2, 200));
})()`);
await realMouseClickAtImage(250, 150);
const vp2 = JSON.parse(await evalJs(`JSON.stringify(window.__DIGITIZER_E2E__.getView())`));
await checkPoint("缩放后换算不变", 1, 7.5, 10, vp2.scale);
ws.close();
console.log(failures === 0 ? "\n🎉 真实鼠标路径 E2E 通过" : `\n💥 ${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);
