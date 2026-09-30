/**
 * 设置的响应式状态：同步配置与外观。
 *
 * 与保险库那个 store 分开是因为**两者生命周期不同**：设置在任何时候都能改（甚至还没建库），
 * 而保险库状态要等密钥就位才有意义。合在一起会让「密钥还没查」这一类中间态污染设置页。
 */

import { defineStore } from 'pinia'
import { ref } from 'vue'
import {
  DEFAULT_SETTINGS,
  readSettings,
  writeSettings,
  type Settings,
  type ThemeMode
} from '@/storage'
import { parseRepo } from '@/sync/gitee'
import { setStatusBarColor } from '@/bridge/handlers'

/** 系统是否偏好深色。旧壳里 `matchMedia` 可能不在，缺了就当浅色 */
function prefersDark(): boolean {
  if (typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

/** 把主题落到 `<html data-theme>` 上 —— 样式表里所有颜色都由它下面的变量说了算 */
function applyTheme(mode: ThemeMode): void {
  const resolved = mode === 'system' ? (prefersDark() ? 'dark' : 'light') : mode
  document.documentElement.dataset.theme = resolved
}

export const useSettingsStore = defineStore('settings', () => {
  const settings = ref<Settings>({ ...readSettings() })

  /** 保存并立刻生效。**存不下也要先让界面用上**（用户在设置里改的那一刻就该看到变化） */
  function save(patch: Partial<Settings>): void {
    settings.value = { ...settings.value, ...patch }
    writeSettings(settings.value)

    if (patch.theme !== undefined) applyTheme(settings.value.theme)
    if (patch.statusBarColor !== undefined) {
      void setStatusBarColor(settings.value.statusBarColor)
    }
  }

  /** 启动时调一次：把存下的主题铺上，并监听系统主题变化（只在「跟随系统」时有意义） */
  function init(): void {
    applyTheme(settings.value.theme)

    if (typeof window.matchMedia === 'function') {
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
        if (settings.value.theme === 'system') applyTheme('system')
      })
    }
  }

  /** 同步用不用得上：仓库与令牌都齐了才算配好 */
  function syncReady(): boolean {
    return Boolean(settings.value.token.trim() && parseRepo(settings.value.repo))
  }

  function reset(): void {
    save({ ...DEFAULT_SETTINGS })
  }

  return { settings, save, init, syncReady, reset, parseRepo }
})