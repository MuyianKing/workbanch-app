/**
 * 提示消息。**没有引 UI 库**，所以这里自己攒一个最小的：一个响应式数组 + 一个宿主组件
 * （`components/ui/ToastHost.vue`）把它画出来。
 *
 * 消息**不做成弹窗**：复制成功、保存成功这类反馈不该拦住用户的手 ——
 * 它只是「刚才那一下生效了」，看一眼就够，所以是屏幕上飘一下就走的条。
 *
 * 用词口径：成功一律「已…」，失败一律带原因 —— 「操作失败」这四个字对用户没有任何用。
 */

import { ref } from 'vue'

export type ToastKind = 'success' | 'info' | 'error'

export interface Toast {
  id: number
  kind: ToastKind
  text: string
}

/** 最多同时显示几条。堆太多会盖住整个界面，而这个 App 里的消息都很短 */
const LIMIT = 3

const DURATION: Record<ToastKind, number> = {
  success: 1900,
  info: 2200,
  // 失败要多留一会儿：用户需要读完那句原因
  error: 3400
}

export const toasts = ref<Toast[]>([])

let counter = 0

function push(kind: ToastKind, text: string): void {
  counter += 1
  const toast: Toast = { id: counter, kind, text }
  toasts.value = [...toasts.value, toast].slice(-LIMIT)

  setTimeout(() => dismiss(toast.id), DURATION[kind])
}

export function dismiss(id: number): void {
  toasts.value = toasts.value.filter((toast) => toast.id !== id)
}

export function notifySuccess(text: string): void {
  push('success', text)
}

export function notifyInfo(text: string): void {
  push('info', text)
}

export function notifyError(text: string): void {
  push('error', text)
}

/** 失败 + 原因，拼成一句话。原因里已经带了「失败」二字时不重复拼 */
export function notifyFailure(what: string, reason: string): void {
  notifyError(reason.includes('失败') ? reason : `${what}失败：${reason}`)
}