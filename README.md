# Digitizer Plus

现代化、跨平台（Windows / macOS）的科研图表数字化工具。从论文截图、扫描曲线中把像素还原成数据 —— "converting pixels into numbers"。

## 特性规划

| 里程碑 | 内容 | 状态 |
|--------|------|------|
| M1 | 图片导入 · 缩放/平移 · XY 两点标定 · 手动取点 · CSV 导出 | ✅ 已完成 |
| M2 | 对数轴（log / semi-log / log-log）· 撤销重做 | ✅ 已完成 |
| M3 | 极坐标图（圆心 O + 半径 R + 角度 θ 三点标定） | ✅ 已完成 |
| M5 | 三元相图（材料/化学/地质） | ✅ 已完成 |
| — | 应用内自动更新（GitHub Releases，三平台签名） | ✅ 已完成 |
| M4 | 自动提取：颜色过滤 · 线段填充 · 相位相关点匹配 | ⏳ |
| M6 | PDF 矢量图导入 · 批量处理 · 多格式导出（Excel/JSON/MATLAB） | ⏳ |

## 下载

前往 [Releases](https://github.com/anyang1991/Digitizer_Plus/releases/latest) 获取 Windows 安装包（）与 macOS 镜像（Intel/Apple Silicon ）。应用内置自动更新，发新版本后会提示一键升级。

## 技术栈

- **后端**：Rust（图像解码 `image`、FFT `rustfft`、线性代数 `nalgebra`）
- **前端**：React 19 + TypeScript + Tailwind CSS 4 + Vite
- **框架**：Tauri 2（安装包 ~15MB，原生性能，Win/macOS/Linux 三平台）

## 开发

```bash
npm install        # 安装前端依赖
npm run tauri dev  # 开发模式（首次会编译 Rust，请耐心）
npm run tauri build # 打包发布版
```

## 致敬与致谢（Acknowledgments）

本项目深受 **[Engauge Digitizer](https://github.com/markummitchell/engauge-digitizer)** 启发（原仓库由 Mark Mitchell 创建，现由社区维护于 [akhuettel/engauge-digitizer](https://github.com/akhuettel/engauge-digitizer)，GPL-2.0）。

我们没有复制其代码：本项目的全部实现均为 Rust + TypeScript 的独立重写，仅借鉴了其公开文档所体现的产品理念（状态机式取数模式、轴点标定流程、点匹配与线段填充的功能设计）。这些底层算法（相位相关、仿射变换、重心坐标）均为数学领域的公开方法。向 Mark Mitchell 与所有社区贡献者致敬。

## 许可

[MIT](LICENSE)
