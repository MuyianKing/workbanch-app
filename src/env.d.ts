/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>
  export default component
}

/**
 * base-app 注入的桥客户端（uni.webview.1.5.6.js）。
 * 只在 App 的 web-view 里存在 —— 浏览器里开发时是 undefined，调用前一律先判。
 */
interface UniWebViewBridge {
  postMessage(options: { data: unknown }): void
}

/*
 * 这个文件是**全局脚本**（没有顶层 import/export），所以直接写 `interface Window` 就是全局增强。
 * 不要再包一层 `declare global` —— 那一层只在外置模块里成立，写在全局脚本里会被整个忽略，
 * 表现就是 client.ts 里 `window.uni` 报「Property 'uni' does not exist」，而这里看着明明写了。
 */
interface Window {
  uni?: UniWebViewBridge
}