/**
 * 桥两侧共用的类型。单独一个文件是为了让 `client.ts`（发）与 `handlers.ts`（包装）
 * 不互相 import —— 它们一个依赖另一个的类型而已。
 */

/** 壳回包解出来的形状：`state` 1 成功 / 0 失败（与 base-app 的 `reply` 对齐） */
export interface BridgePayload {
  state: number
  data: unknown
}

/** 壳给的命令名。**只增不改**（见 AGENTS.md 第 5 节）—— 改名要同时改 base-app 的 handlers */
export type BridgeCommand = 'getEnv' | 'getSafeArea' | 'setStatusBarColor'

/** `getSafeArea` 的回包：与 `uni.getSystemInfoSync().safeAreaInsets` 同形，单位 px */
export interface SafeArea {
  top: number
  bottom: number
  left: number
  right: number
}