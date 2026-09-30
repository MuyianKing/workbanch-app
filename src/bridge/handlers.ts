/**
 * 壳能力的一层包装：把「命令名 + 参数」这套协议收在这里，界面与 store 只调这几个函数。
 *
 * **每个函数在不在 App 里都能调**：不在 App 里（浏览器开发）时返回一个合理的默认值，
 * 而不是让调用方到处写 try/catch。安全区回退成全 0 —— 浏览器里本来也没有刘海，
 * 拿 0 当内边距等于「不额外留白」，是正确的结果而不是一个需要用户处理的错误。
 */

import { call, isInApp } from './client'
import type { SafeArea } from './types'

export { isInApp }

/** 没有安全区信息时的兜底：全 0（不额外留白） */
const NO_SAFE_AREA: SafeArea = { top: 0, bottom: 0, left: 0, right: 0 }

/** 当前跑在什么形态的壳里（base-app 现在回 `'pad'`） */
export async function getEnv(): Promise<string> {
  try {
    return await call<string>('getEnv')
  } catch {
    return 'h5'
  }
}

/** 安全区。刘海屏上顶栏与底部要给这么多内边距，否则内容会被状态栏 / 手势条压住 */
export async function getSafeArea(): Promise<SafeArea> {
  try {
    const area = await call<SafeArea>('getSafeArea')
    if (!area || typeof area !== 'object') return NO_SAFE_AREA
    // 逐个数值兜底：壳回一个 `{top: null}` 时不该让整个界面塌掉
    return {
      top: Number(area.top) || 0,
      bottom: Number(area.bottom) || 0,
      left: Number(area.left) || 0,
      right: Number(area.right) || 0
    }
  } catch {
    return NO_SAFE_AREA
  }
}

/**
 * 状态栏颜色。**壳把前景色写死成白色**（见 base-app 的 `handlers.js`），
 * 所以这里传的颜色要偏深，否则白字看不见 —— 设置页里默认给的也是深色。
 */
export async function setStatusBarColor(color: string): Promise<boolean> {
  try {
    return await call<boolean>('setStatusBarColor', { color })
  } catch {
    return false
  }
}

/**
 * 启动时把这些一次性做完：拿到安全区、把状态栏刷成用户选的颜色。
 * 返回值交给界面写进 CSS 变量。
 */
export async function initShell(statusBarColor: string): Promise<{ safeArea: SafeArea; env: string }> {
  const [safeArea, env] = await Promise.all([getSafeArea(), getEnv()])
  if (isInApp()) void setStatusBarColor(statusBarColor)
  return { safeArea, env }
}