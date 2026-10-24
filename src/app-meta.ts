/**
 * Digitizer Plus 致敬声明
 *
 * 本项目深受 Engauge Digitizer (https://github.com/markummitchell/engauge-digitizer，
 * 现由社区维护于 https://github.com/akhuettel/engauge-digitizer，GPL-2.0) 启发。
 * 我们没有复制其代码，而是用 Rust + TypeScript 独立实现了类似的数据数字化理念：
 * "When you engauge a document, you are converting pixels into numbers."
 * 感谢 Mark Mitchell 及所有社区贡献者对开源数字化工具的贡献。
 */

export const APP_NAME = "Digitizer Plus";
export const APP_VERSION = "0.1.0";

/** 状态机模式 —— 对应上游 DigitizeStateContext 的设计理念 */
export type DigitizeMode =
  | "select" // 选择/编辑点
  | "axis" // 轴点标定（XY: 2-3 点）
  | "polar-axis" // 极坐标标定（圆心 O + 半径 R + 角度 θ）
  | "ternary-axis" // 三元相图标定（三个顶点）
  | "curve-point" // 手动曲线取点
  | "point-match" // 自动点匹配（相位相关）
  | "segment-fill" // 线段填充（颜色过滤追踪）
  | "color-picker"; // 取色器（定义颜色过滤器）
