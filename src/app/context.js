/**
 * 应用上下文：页面/组件通过 app() 读取 state 与 helpers，避免与 main.js 循环依赖。
 * main.js 启动时调用 bindApp() 一次。
 */

/** @type {Record<string, any>} */
const ctx = {};

/** @param {Record<string, any>} bindings */
export function bindApp(bindings) {
  Object.assign(ctx, bindings);
}

/** @returns {Record<string, any>} */
export function app() {
  return ctx;
}
