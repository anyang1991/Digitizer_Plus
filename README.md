# Digitizer Plus

现代化、跨平台（Windows / macOS）的科研图表数字化工具。从论文截图、扫描曲线中把像素还原成数据 —— "converting pixels into numbers"。

## 功能

| 功能 | 说明 | 状态 |
|------|------|------|
| 图片导入 | 点击选择或拖拽；PNG / JPEG / BMP / GIF / WebP / TIFF | ✅ |
| 画布浏览 | 滚轮缩放（鼠标锚点）· Alt/中键/右键拖拽平移 | ✅ |
| XY 图标定 | 两点标定，X/Y 轴独立；支持线性与对数轴（semi-log / log-log） | ✅ |
| 极坐标标定 | 圆心 O + 半径 R + 角度 θ 三点标定，角度支持 0–360 与 ±180 惯例 | ✅ |
| 三元相图标定 | 三顶点重心坐标（材料 / 化学 / 地质） | ✅ |
| 手动取点 | 沿曲线点击添加，实时显示数据坐标；撤销栈覆盖全部操作 | ✅ |
| CSV 导出 | 按图表类型输出 `x,y` / `theta,r` / `a,b,c` 列 | ✅ |
| 应用内自动更新 | GitHub Releases 签名分发，新版本一键升级 | ✅ |

## 下载

前往 [Releases](https://github.com/anyang1991/Digitizer_Plus/releases/latest) 获取安装包：

- **Windows**：`Digitizer.Plus_x.y.z_x64-setup.exe`（安装版）或 `.msi`
- **macOS**：`Digitizer.Plus_x.y.z_x64.dmg`（Intel）/ `Digitizer.Plus_x.y.z_aarch64.dmg`（Apple Silicon）

应用内置自动更新，发新版本后会提示一键升级。

## 使用流程

1. **导入**图表图片（拖入窗口或点击「导入图片」）
2. **选择图表类型**（顶栏：XY 图 / 极坐标图 / 三元相图；XY 可切换每轴线性/对数）
3. **标定**：按左侧工具栏向导点击已知坐标点并输入数值
   - XY：X 轴 2 点 + Y 轴 2 点
   - 极坐标：圆心 O → 半径 R → 角度 θ
   - 三元：顶点 A → B → C
4. **取点**：切换「取点」模式沿曲线点击，右侧实时显示数据坐标
5. **导出 CSV**

## 技术栈

- **后端**：Rust（图像解码 `image`、FFT `rustfft`、线性代数 `nalgebra`）
- **前端**：React 19 + TypeScript + Tailwind CSS 4 + Vite
- **框架**：Tauri 2（安装包 ~15MB，原生性能，Win/macOS/Linux 三平台）

## 开发

```bash
npm install         # 安装前端依赖
npm run tauri dev   # 开发模式（首次会编译 Rust，请耐心）
npm run tauri build # 打包发布版
```

测试：

```bash
cd src-tauri && cargo test          # 坐标变换核心单元测试
node scripts/e2e-chart-types.mjs    # 图表类型 E2E（需先启动 dev 实例）
node scripts/e2e-polar-ring.mjs     # 极坐标八方位精度环测
node scripts/e2e-real-mouse-polar.mjs # 真实鼠标事件流测试
```

## 发新版本

```bash
git tag vX.Y.Z && git push origin vX.Y.Z
```

GitHub Actions 自动构建三平台签名安装包并发布 Release；已安装用户会收到应用内更新提示。

## 致敬与致谢（Acknowledgments）

本项目深受 **[Engauge Digitizer](https://github.com/markummitchell/engauge-digitizer)** 启发（原仓库由 Mark Mitchell 创建，现由社区维护于 [akhuettel/engauge-digitizer](https://github.com/akhuettel/engauge-digitizer)，GPL-2.0）。

我们没有复制其代码：本项目的全部实现均为 Rust + TypeScript 的独立重写，仅借鉴了其公开文档所体现的产品理念（状态机式取数模式、轴点标定流程）。这些底层算法（仿射变换、相位相关、重心坐标）均为数学领域的公开方法。向 Mark Mitchell 与所有社区贡献者致敬。

## 许可

[MIT](LICENSE)
