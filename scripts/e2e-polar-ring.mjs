// 极坐标完整环测：θ=0/45/90/135/180/225/270/315 八方位 + 半径精度
// 前置：应用运行且 CDP 9222 可用
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

/* PNG 编码 */
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

/* 400x400 图：圆心 (200,200)，r=10 对应 100px。画参考环和测试标记 */
const W = 400, H = 400, CX = 200, CY = 200;
const raw = Buffer.alloc(H * (1 + W * 3));
const px = (x, y, v) => {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const o = y * (1 + W * 3) + 1 + x * 3;
  raw[o] = v; raw[o + 1] = v; raw[o + 2] = v;
};
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) px(x, y, 255);
// 在 8 个方位、半径 5（50px）处画 5x5 十字标记（中心像素为点击目标）
const marks = [];
for (let i = 0; i < 8; i++) {
  const deg = i * 45;
  const rad = (deg * Math.PI) / 180;
  // 屏幕系：θ 逆时针 → 屏幕坐标 dx = cos(θ)*R, dy = -sin(θ)*R
  const mx = Math.round(CX + 50 * Math.cos(rad));
  const my = Math.round(CY - 50 * Math.sin(rad));
  marks.push({ deg, mx, my });
  for (let d = -2; d <= 2; d++) { px(mx + d, my, 0); px(mx, my + d, 0); }
}
await evalJs(`window.__img = {
  name: "polar-ring.png", mime: "image/png", width: ${W}, height: ${H},
  dataBase64: "${makePng(W, H, raw).toString("base64")}",
}`);
await evalJs(`(async () => {
  window.__DIGITIZER_E2E__.loadImage(window.__img);
  await new Promise(r => setTimeout(r, 400));
})()`);

// 标定：O(200,200)、R 点 (300,200) r=10、θ 点 (200,100) θ=90
// UI 流程为 点击→弹窗输入 交替，不能连点
await evalJs(`window.__DIGITIZER_E2E__.setChartType("polar")`);
await new Promise((r) => setTimeout(r, 300)); // 等待 React 类型切换生效
await evalJs(`window.__DIGITIZER_E2E__.setMode("polar")`);
await new Promise((r) => setTimeout(r, 200));
async function submit(v) {
  await evalJs(`(async () => {
    const input = document.querySelector('main input');
    if (!input) throw new Error('输入框未出现');
    const setVal = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setVal.call(input, '${v}');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 60));
    [...document.querySelectorAll('main button')].find(b => b.textContent === '确定').click();
    await new Promise(r => setTimeout(r, 120));
  })()`);
}
await evalJs(`window.__DIGITIZER_E2E__.simulateClick(200, 200)`); // O：无弹窗
await new Promise((r) => setTimeout(r, 100));
await evalJs(`window.__DIGITIZER_E2E__.simulateClick(300, 200)`); // R 点 → 弹窗
await new Promise((r) => setTimeout(r, 100));
await submit("10");
await evalJs(`window.__DIGITIZER_E2E__.simulateClick(200, 100)`); // θ 点 → 弹窗
await new Promise((r) => setTimeout(r, 100));
await submit("90");
await evalJs(`window.__DIGITIZER_E2E__.setMode("curve-point")`);
await new Promise((r) => setTimeout(r, 200)); // 等待 React 重渲染使新模式生效

// 逐点点击 8 个标记并校验
let failures = 0;
for (const { deg, mx, my } of marks) {
  await evalJs(`window.__DIGITIZER_E2E__.simulateClick(${mx}, ${my})`);
  await new Promise((r) => setTimeout(r, 80));
  const s = JSON.parse(await evalJs(`JSON.stringify(window.__DIGITIZER_E2E__.getState())`));
  const p = s.points[s.points.length - 1];
  const theta = p.graph.x, r = p.graph.y;
  // 期望：θ=deg（十字中心=精确方位），r=50px*0.1=5
  const errT = Math.abs(theta - deg);
  const errR = Math.abs(r - 5);
  const ok = errT < 0.6 && errR < 0.06;
  if (!ok) failures++;
  console.log(`${ok ? "✅" : "❌"} θ=${String(deg).padStart(3)}°: 实测 θ=${theta.toFixed(2)}° (误差 ${errT.toFixed(2)}), r=${r.toFixed(3)} (误差 ${errR.toFixed(3)})`);
}
console.log(failures === 0 ? "\n🎉 极坐标八方位环测全部通过" : `\n💥 ${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);
