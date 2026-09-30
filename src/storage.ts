/**
 * 本机存储：保险库密钥、设备标识、设置。
 *
 * **密钥为什么在这里**：壳（base-app）没有凭据管理器，桌面端那套「私钥只进 Windows
 * 凭据管理器」的路走不通。用户确认的方案是 `localStorage` 直接放密钥串（见 AGENTS.md 第 4 节）——
 * 它的安全性等价于「这台设备上的这个 App」，能打开 App 的人就能读到它。
 * **不要把它当成一道防线**：它的作用只是省去每次启动都重新导入一次密钥。
 *
 * 换个说法：这个 App 防的是「离开座位时密码摊在屏幕上」，不是「别人拿到这台设备」。
 * 界面上的引导文案要如实这么说，别许诺做不到的事。
 */

import type { SafeArea } from './bridge/types'

const KEY_STORAGE = 'vault.key'
const DEVICE_STORAGE = 'vault.device'
const SETTINGS_STORAGE = 'vault.settings'

export type ThemeMode = 'system' | 'light' | 'dark'

export interface Settings {
  /** 同步仓库，`owner/repo`；也接受整条 gitee 地址（`parseRepo` 会认） */
  repo: string
  /** 分支名 */
  branch: string
  /** Gitee 私人令牌 */
  token: string
  /** 主题：跟随系统 / 强制浅色 / 强制深色 */
  theme: ThemeMode
  /** 状态栏底色。壳把前景色写死成白色，所以这一栏要选偏深的颜色 */
  statusBarColor: string
  /** 打开页面时密码是否默认遮住。关掉之后一屏都是明文，只适合自己确认过的场合 */
  maskByDefault: boolean
}

export const DEFAULT_SETTINGS: Settings = {
  repo: '',
  branch: 'master',
  token: '',
  theme: 'system',
  // 深色：壳的状态栏前景色是白的，浅底会让时间 / 电量看不见
  statusBarColor: '#14161b',
  maskByDefault: true
}

/** localStorage 在极少数情况下会抛（隐私模式、配额满），所有读写一律兜住 */
function read(storageKey: string): string | null {
  try {
    return window.localStorage.getItem(storageKey)
  } catch {
    return null
  }
}

function write(storageKey: string, value: string): void {
  try {
    window.localStorage.setItem(storageKey, value)
  } catch {
    // 存不进去就当作「这次不记」：不阻断用户正在做的事
  }
}

function remove(storageKey: string): void {
  try {
    window.localStorage.removeItem(storageKey)
  } catch {
    // 同上
  }
}

// ---------- 保险库密钥 ----------

/** 密钥串（`workbench-vault-v1.<base64url>`）。认不认得出是密钥由 `parseKeyString` 判 */
export function readKeyString(): string | null {
  return read(KEY_STORAGE)
}

export function writeKeyString(text: string): void {
  write(KEY_STORAGE, text)
}

export function clearKeyString(): void {
  remove(KEY_STORAGE)
}

// ---------- 设备标识 ----------

/**
 * 这台设备的稳定标识，写进每条记录的 `by` 字段。
 *
 * **必须是稳定且两台设备必定不同的值**：合并时「同一时刻两边都改过」要靠它破平，
 * 而判据是「两台设备算得一样」—— 所以不能用机器名（可能重复、也可能被改），
 * 也不能每次现生成（那样同一台设备的历史记录会分裂成好几个来源）。
 */
export function deviceId(): string {
  const existing = read(DEVICE_STORAGE)
  if (existing) return existing

  const created = crypto.randomUUID()
  write(DEVICE_STORAGE, created)
  return created
}

// ---------- 设置 ----------

/** 读设置。**逐字段兜底**：老版本存下的、或被手工改坏的一项不该让整份设置作废 */
export function readSettings(): Settings {
  const raw = read(SETTINGS_STORAGE)
  if (!raw) return { ...DEFAULT_SETTINGS }

  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return { ...DEFAULT_SETTINGS }
    const value = parsed as Record<string, unknown>

    const text = (key: string, fallback: string): string =>
      typeof value[key] === 'string' ? (value[key] as string) : fallback

    const theme = value.theme
    return {
      repo: text('repo', DEFAULT_SETTINGS.repo),
      branch: text('branch', DEFAULT_SETTINGS.branch) || DEFAULT_SETTINGS.branch,
      token: text('token', DEFAULT_SETTINGS.token),
      theme: theme === 'light' || theme === 'dark' || theme === 'system' ? theme : DEFAULT_SETTINGS.theme,
      statusBarColor: text('statusBarColor', DEFAULT_SETTINGS.statusBarColor),
      maskByDefault:
        typeof value.maskByDefault === 'boolean' ? value.maskByDefault : DEFAULT_SETTINGS.maskByDefault
    }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function writeSettings(settings: Settings): void {
  try {
    write(SETTINGS_STORAGE, JSON.stringify(settings))
  } catch {
    // 同上：设置存不下不阻断使用
  }
}

// ---------- 安全区（只在内存里） ----------

/**
 * 安全区是**运行时**的东西（旋转屏幕、进电话后会变），不落盘 —— 落盘的那份第二次启动
 * 就是错的，而错的内边距会把顶栏顶到状态栏底下，比没有更糟。
 */
let safeArea: SafeArea = { top: 0, bottom: 0, left: 0, right: 0 }

export function setSafeArea(area: SafeArea): void {
  safeArea = area
}

export function currentSafeArea(): SafeArea {
  return safeArea
}