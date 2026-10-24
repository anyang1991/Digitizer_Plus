// 多图表类型全流程 E2E：XY 线性 / XY 对数 / 极坐标 / 三元相图
// 每种类型用专属生成的测试图，走真实 UI 流程（模式切换 + 数值弹窗）。
// 前置：应用以 WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222 运行
import zlib from "node:zlib";

const CDP_PORT = 9222;
let failures = 0;

/* ---------------- PNG 生成（真彩色，支持画线/画点） ---------------- */

class Png {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.raw = Buffer.alloc(h * (1 + w * 3));
  }
  px(x, y, r = 0, g = 0, b = 0) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const off = y * (1 + this.w * 3) + 1 + x * 3;
    this.raw[off] = r; this.raw[off + 1] = g; this.raw[off + 2] = b;
  }
  fillAll(v) {
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++) this.px(x, y, v, v, v);
  }
  rect(x0, y0, x1, y1, v = 0) {
    for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++)
      for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) this.px(x, y, v, v, v);
  }
  /** Bresenham 线段 */
  line(x0, y0, x1, y1, v = 0) {
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.px(x0, y0, v, v, v);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }
  toBuffer() {
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
    ihdr.writeUInt32BE(this.w, 0);
    ihdr.writeUInt32BE(this.h, 4);
    ihdr[8] = 8; ihdr[9] = 2;
    return Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", ihdr),
      chunk("IDAT", zlib.deflateSync(this.raw)),
      chunk("IEND", Buffer.alloc(0)),
    ]);
  }
}

/* ---------------- CDP 基础设施 ---------------- */

const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
const page = list.find((t) => t.type === "page");
if (!page) throw new Error("未找到应用页面");
console.log("target:", page.url);

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
    pendingMap.set(id, res );
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
function check(name, actual, expect) {
  const ok = String(actual) === String(expect);
  if (!ok) failures++;
  console.log(`${ok ? "✅" : "❌"} ${name}: got "${actual}"${ok ? "" : ` (expected "${expect}")`}`);
}

async function loadImage(png, name) {
  const b64 = png.toBuffer().toString("base64");
  await evalJs(`window.__img = {
    name: "${name}", mime: "image/png", width: ${png.w}, height: ${png.h}, dataBase64: "${b64}",
  }`);
  await evalJs(`(async () => {
    window.__DIGITIZER_E2E__.loadImage(window.__img);
    await new Promise(r => setTimeout(r, 400));
  })()`);
}
async function clickMode(label) {
  await evalJs(`(async () => {
    [...document.querySelectorAll('nav button')].find(b => b.textContent.includes('${label}'))?.click();
    await new Promise(r => setTimeout(r, 100));
  })()`);
}
async function submitValue(v) {
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
async function pick(imgX, imgY) {
  await evalJs(`(async () => {
    window.__DIGITIZER_E2E__.simulateClick(${imgX}, ${imgY});
    await new Promise(r => setTimeout(r, 100));
  })()`);
}
async function state() {
  return JSON.parse(await evalJs(`JSON.stringify(window.__DIGITIZER_E2E__.getState())`));
}
async function reset() {
  await evalJs(`window.__DIGITIZER_E2E__.setMode("select")`);
  // 用一次全新的 loadImage 清空全部状态
  await loadImage(new Png(10, 10), "reset");
}

/* ================= 1. XY 线性 ================= */
console.log("\n── XY 线性轴 ──");
{
  // 400x300 白图，画一条从 (100,250) 到 (300,50) 的直线（理论 y = 20 - 0.1x'
  // 标定：x 轴 100px→0, 300px→10（每 px 0.05）；y 轴 250px→0, 50px→20（每 px -0.1）
  const png = new Png(400, 300);
  png.fillAll(255);
  png.line(100, 250, 300, 50);
  await loadImage(png, "xy-linear.png");

  await evalJs(`window.__DIGITIZER_E2E__.setChartType("xy")`);
  await evalJs(`window.__DIGITIZER_E2E__.setXScale("linear")`);
  await evalJs(`window.__DIGITIZER_E2E__.setYScale("linear")`);
  await clickMode("X 轴点");
  await pick(100, 280); await submitValue("0");
  await pick(300, 280); await submitValue("10");
  await clickMode("Y 轴点");
  await pick(50, 250); await submitValue("0");
  await pick(50, 50); await submitValue("20");
  const s = await state();
  check("XY线性-xDefined", s.xDefined, "true");
  check("XY线性-yDefined", s.yDefined, "true");

  // 曲线上取三点：图像 (100,250)→(0,0)、(200,150)→(5,10)、(300,50)→(10,20)
  await clickMode("取点");
  await pick(100, 250); await pick(200, 150); await pick(300, 50);
  const s2 = await state();
  check("XY线性-点数", s2.points.length, "3");
  check("XY线性-CSV", s2.csv, "x,y\n0,0\n5,10\n10,20\n");
}
await reset();

/* ================= 2b. XY log-log ================= */
console.log("\n── XY 双对数（log-log: 1→100 双轴）──");
{
  // 400x300。x: 99px→1, 399px→100（300px 跨 2 数量级）；y: 250px→1, 100px→100（150px 跨 2 数量级）
  // 测试点 (10,10)：x_px = 99+150=249, y_px = 250-75=175
  const png = new Png(400, 300);
  png.fillAll(255);
  png.rect(246, 172, 252, 178); // 标记中心 (249,175)
  await loadImage(png, "xy-loglog.png");

  await evalJs(`window.__DIGITIZER_E2E__.setChartType("xy")`);
  await new Promise((r) => setTimeout(r, 300));
  await evalJs(`window.__DIGITIZER_E2E__.setXScale("log")`);
  await evalJs(`window.__DIGITIZER_E2E__.setYScale("log")`);
  await new Promise((r) => setTimeout(r, 200));
  await clickMode("X 轴点");
  await pick(99, 280); await submitValue("1");
  await pick(399, 280); await submitValue("100");
  await clickMode("Y 轴点");
  await pick(50, 250); await submitValue("1");
  await pick(50, 100); await submitValue("100");
  await clickMode("取点");
  await pick(249, 175);
  const s = await state();
  const gx = s.points[0].graph.x, gy = s.points[0].graph.y;
  const ok = Math.abs(gx - 10) < 0.1 && Math.abs(gy - 10) < 0.1;
  if (!ok) failures++;
  console.log(`${ok ? "✅" : "❌"} log-log 换算: (${gx.toFixed(3)}, ${gy.toFixed(3)}) 期望 (10, 10)`);
}
/* ================= 2a. XY 半对数 ================= */
console.log("\n── XY 半对数（X 轴 log10: 1→1000）──");
{
  // 400x300。x 轴 log：100px→1, 400px→1000（300px 跨 3 个数量级，每数量级 100px）
  // v=10 恰在 200px；y 轴线性 250px→0, 50px→10，py=150 → 5
  const png = new Png(400, 300);
  png.fillAll(255);
  png.rect(197, 147, 203, 153); // 测试点标记（中心 200,150）
  await loadImage(png, "xy-semilog.png");

  await evalJs(`window.__DIGITIZER_E2E__.setChartType("xy")`);
  await evalJs(`window.__DIGITIZER_E2E__.setXScale("log")`);
  await evalJs(`window.__DIGITIZER_E2E__.setYScale("linear")`);
  await clickMode("X 轴点");
  await pick(99, 280); await submitValue("1");
  await pick(399, 280); await submitValue("1000");
  await clickMode("Y 轴点");
  await pick(50, 250); await submitValue("0");
  await pick(50, 50); await submitValue("10");
  await clickMode("取点");
  await pick(199, 150); // (199-99)/300=1/3 数量级 → 恰为 10
  const s = await state();
  const gx = s.points[0].graph.x, gy = s.points[0].graph.y;
  const okX = Math.abs(gx - 10) / 10 < 0.005;
  const okY = Math.abs(gy - 5) < 0.05;
  if (!okX || !okY) failures++;
  console.log(`${okX && okY ? "✅" : "❌"} 半对数换算: x=${gx.toFixed(3)} (期望≈10), y=${gy.toFixed(3)} (期望≈5)`);
}
await reset();

/* ================= 3. 极坐标 ================= */
console.log("\n── 极坐标图 ──");
{
  // 400x300。圆心 (200,150)。半径点：正右方 (300,150) r=10（每 px 0.1）
  // θ 参考：正上方 (200,50) θ=90°。测试点：45° 方向 r=5 → 圆心 + (35.36, -35.36) ≈ (235,115)
  const png = new Png(400, 300);
  png.fillAll(255);
  png.rect(233, 113, 237, 117); // 测试点标记（中心 235,115）
  await loadImage(png, "polar.png");

  await evalJs(`window.__DIGITIZER_E2E__.setChartType("polar")`);
  await clickMode("极坐标点");
  await pick(200, 150); // O
  await pick(300, 150); await submitValue("10"); // R=10
  await pick(200, 50); await submitValue("90"); // θ=90
  const s0 = await state();
  check("极坐标-标定完成", s0.polarDefined, "true");

  await clickMode("取点");
  await pick(235, 115);
  const s = await state();
  const theta = s.points[0].graph.x, r = s.points[0].graph.y;
  // 点击 (235,115)：dx=+35, dy=-35 → r=49.50px*0.1=4.95
  // 屏幕右上方向 = 数学第一象限 → θ = 90°-45° = 45°（右=0°, 上=90° 标准约定）
  const okT = Math.abs(theta - 45) < 0.5;
  const okR = Math.abs(r - 4.95) < 0.05;
  if (!okT || !okR) failures++;
  console.log(`${okT && okR ? "✅" : "❌"} 极坐标换算: θ=${theta.toFixed(2)}° (期望≈45), r=${r.toFixed(3)} (期望≈4.95)`);
  check("极坐标-CSV 表头", s.csv.split("\n")[0], "theta,r");
}
await reset();

/* ================= 4. 三元相图 ================= */
console.log("\n── 三元相图 ──");
{
  // 等边三角形：A(200,50) B(100,223) C(300,223)。测试点 = BC 边中点 (200,223) → (0,50,50)
  // 以及重心 (200,165) → (33.3,33.3,33.3)
  const png = new Png(400, 300);
  png.fillAll(255);
  png.line(200, 50, 100, 223); png.line(100, 223, 300, 223); png.line(300, 223, 200, 50);
  await loadImage(png, "ternary.png");

  await evalJs(`window.__DIGITIZER_E2E__.setChartType("ternary")`);
  await clickMode("顶点");
  await pick(200, 50);  // A
  await pick(100, 223); // B
  await pick(300, 223); // C
  const s0 = await state();
  check("三元-标定完成", s0.ternaryDefined, "true");

  await clickMode("取点");
  await pick(200, 223); // BC 中点
  await pick(200, 165); // 重心
  const s = await state();
  const [p1, p2] = s.points;
  const ok1 = Math.abs(p1.graph.x) < 0.5 && Math.abs(p1.graph.y - 50) < 0.5 && Math.abs(p1.graph.c - 50) < 0.5;
  const ok2 = Math.abs(p2.graph.x - 33.33) < 0.5 && Math.abs(p2.graph.y - 33.33) < 0.5;
  if (!ok1 || !ok2) failures++;
  console.log(`${ok1 && ok2 ? "✅" : "❌"} 三元换算: BC中点=(${p1.graph.x.toFixed(1)},${p1.graph.y.toFixed(1)},${p1.graph.c.toFixed(1)}) 期望(0,50,50); 重心=(${p2.graph.x.toFixed(1)},${p2.graph.y.toFixed(1)},${p2.graph.c.toFixed(1)}) 期望(33.3,33.3,33.3)`);
  check("三元-CSV 表头", s.csv.split("\n")[0], "a,b,c");
  // 三元和为 100
  const sum = p1.graph.x + p1.graph.y + p1.graph.c;
  check("三元-分量和", Math.round(sum), "100");
}

ws.close();
console.log(failures === 0 ? "\n🎉 全部图表类型 E2E 通过" : `\n💥 ${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);
