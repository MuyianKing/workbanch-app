/**
 * 密码保险库的状态类型。与 Workbench 的 `apps/desktop/.../types.ts` 里那几组一致 ——
 * 界面打交道的形状两边相同，只是这边没有 Rust 那一层。
 */

import type { VaultRecord } from './vault/file'

/** 密钥状态。界面据此选三种样子之一（还没建库 / 锁着 / 已解锁） */
export interface VaultKeyState {
  exists: boolean
  unlocked: boolean
  /** 公钥指纹（`A1B2-C3D4-E5F6`）。**没解锁也算得出来** —— 它就是公钥的摘要，是公开信息 */
  fingerprint: string
}

/** 读出全部条目的结果 */
export interface VaultLoaded {
  records: VaultRecord[]
  /** 用别的密钥加的密、在这台设备上读不出来的条数 */
  unreadable: number
  /** 信封本身坏掉、被丢掉的条数 */
  dropped: number
  /** 最近一次改动的时间（毫秒），一条都没有时 0 */
  updatedAt: number
}

/** 一轮同步的结果 */
export interface VaultSyncOutcome extends VaultLoaded {
  /** 实际走了几轮（远端被别的设备改过时会重走） */
  rounds: number
  /** 拉回来的那一份里有几条 */
  remoteItems: number
  /** 仓库里那份是用别的密钥加的密 */
  keyMismatch: boolean
}