/**
 * 与 base-app 壳的桥客户端：发一条消息出去，等它回一个结果。
 *
 * **协议**（与 base-app 的 `pages/index/index.vue` 对齐，见 AGENTS.md 第 5 节）：
 *   1. H5 侧 `uni.postMessage({ data: { uuid, type, params } })`；
 *   2. 壳侧查到 `bridge/handlers.js` 里对应的处理器，执行完调
 *      `webview.evalJS('window["<uuid>"](<payload>)')`；
 *   3. H5 侧挂在 `window[uuid]` 上的函数被调用，收到 `{ state, data }` 的 **JSON 串**。
 *
 * 三个容易踩的点，都在下面处理掉了：
 *   - 壳的回包是**字符串**不是对象（它用 `JSON.stringify(payload)` 拼进一段 JS 源码），
 *     所以这里必须 `JSON.parse`；两边都收着，是因为将来壳改成直接传对象时不用再改这里。
 *   - `window[uuid]` 是**全局污染**，用完必须删掉，否则反复同步会一直往上堆。
 *   - 壳可能根本没回（webview 被销毁、handler 里抛了未捕获的错），所以每次调用都带超时。
 */

import type { BridgePayload } from './types'

/** 默认超时：桥是**本机进程间**通信，正常在一帧内就回；超过这个数只可能是出了问题 */
const DEFAULT_TIMEOUT = 5000

let counter = 0

/** 壳是否在场。`uni` 这个全局在浏览器里也存在（脚本自己挂的），所以不能拿它当判据 */
export function isInApp(): boolean {
  if (typeof window === 'undefined') return false
  const w = window as unknown as Record<string, unknown>
  return Boolean(
    w.plus ||
      w.__uniapp_x_postMessage ||
      w.__dcloud_weex_postMessage ||
      /Html5Plus|uni-app/i.test(navigator.userAgent)
  )
}

/** 把回调挂到 window 上并返回一个撤销函数，调用方在 finally 里用它 */
function mountCallback(uuid: string, resolve: (value: BridgePayload) => void): () => void {
  const holder = window as unknown as Record<string, unknown>
  holder[uuid] = (raw: unknown) => {
    if (typeof raw === 'string') {
      try {
        resolve(JSON.parse(raw) as BridgePayload)
        return
      } catch {
        resolve({ state: 0, data: null })
        return
      }
    }
    resolve((raw as BridgePayload) ?? { state: 0, data: null })
  }

  return () => {
    delete holder[uuid]
  }
}

/**
 * 发一条命令给壳，等它的结果。**不在 App 里时直接抛**，调用方据此走降级分支 ——
 * 而不是干等五秒超时（浏览器里开发时每一处都会白等一次，很烦）。
 */
export function call<T>(type: string, params?: unknown, timeout = DEFAULT_TIMEOUT): Promise<T> {
  if (!isInApp()) {
    return Promise.reject(new Error('不在 App 环境里，壳能力不可用'))
  }

  const bridge = window.uni
  if (!bridge || typeof bridge.postMessage !== 'function') {
    return Promise.reject(new Error('桥客户端（uni.webview.js）没有加载'))
  }

  counter += 1
  const uuid = `bridge-${Date.now()}-${counter}`

  return new Promise<T>((resolve, reject) => {
    let settled = false
    const unmount = mountCallback(uuid, (payload) => {
      if (settled) return
      settled = true
      unmount()
      clearTimeout(timer)
      if (payload.state === 1) resolve(payload.data as T)
      else reject(new Error(describePayload(payload.data)))
    })

    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      unmount()
      reject(new Error(`壳没有回应「${type}」`))
    }, timeout)

    try {
      bridge.postMessage({ data: { uuid, type, params: params ?? {} } })
    } catch (error) {
      settled = true
      unmount()
      clearTimeout(timer)
      reject(error instanceof Error ? error : new Error('桥发送失败'))
    }
  })
}

/** 壳回的错误可能是一句话、也可能是个对象（见 base-app 的 reply），这里统一成一句 */
function describePayload(data: unknown): string {
  if (typeof data === 'string' && data) return data
  if (data && typeof data === 'object') {
    const message = (data as Record<string, unknown>).message
    if (typeof message === 'string' && message) return message
  }
  return '壳执行这条命令失败了'
}