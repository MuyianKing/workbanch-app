/**
 * 保险库的响应式状态：三种外观（还没建库 / 锁着 / 已解锁）+ 卡片墙要的那几个派生值。
 *
 * 这里**只做状态与编排**，算式全在 `sync/vault.ts` 与 `vault/` 里（纯函数、带单测）。
 * 这么分是因为纯函数能单测、也容易看明白；而这个 store 的职责是「什么时候调它们、
 * 把结果放到哪个字段、失败了界面该看到什么」。
 */

import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { VaultEntry, VaultRecord } from '@/vault/file'
import {
  filterVaultRecords,
  groupVaultRecords,
  sortVaultRecords,
  vaultGroups
} from '@/vault/file'
import * as vault from '@/sync/vault'
import type { GiteeConfig } from '@/sync/gitee'
import { parseRepo } from '@/sync/gitee'
import type { VaultSyncOutcome } from '@/types'
import { useSettingsStore } from '@/stores/settings'
import { notifyFailure, notifySuccess } from '@/toast'

/** 一轮同步之后给用户看的那句话。**成功也说** —— 不然用户不知道刚才那一下有没有生效 */
function describeSync(outcome: VaultSyncOutcome): string {
  const total = outcome.records.length
  if (outcome.keyMismatch) return '同步完成，但仓库里那份是用别的密钥加的密，那些记录在这台设备上解不开'
  if (outcome.rounds > 1) return `同步完成（远端被改过，重试了 ${outcome.rounds} 轮），共 ${total} 条`
  return `同步完成，共 ${total} 条`
}

export const useVaultStore = defineStore('vault', () => {
  const settingsStore = useSettingsStore()

  // ---------- 密钥状态 ----------
  /** 密钥状态是否已经问过。**必须挡在界面之前**：`keyExists` 初值是 false，
   *  不挡这一下的话页面会先闪一帧「创建保险库」的引导再跳成真的样子 */
  const keyChecked = ref(false)
  const keyExists = ref(false)
  const unlocked = ref(false)
  const fingerprint = ref('')

  // ---------- 条目 ----------
  const records = ref<VaultRecord[]>([])
  const unreadable = ref(0)
  const dropped = ref(0)
  const updatedAt = ref(0)
  /** 仓库里那份是用别的密钥加的密（同步时才知道） */
  const keyMismatch = ref(false)

  // ---------- 界面状态 ----------
  const query = ref('')
  const loading = ref(false)
  const creating = ref(false)
  const syncing = ref(false)
  /** 上一次同步的结果那句话；空串表示还没同步过 */
  const syncNote = ref('')
  const syncFailed = ref(false)

  // ---------- 派生值 ----------
  const visibleRecords = computed(() => sortVaultRecords(filterVaultRecords(records.value, query.value)))
  const sections = computed(() => groupVaultRecords(visibleRecords.value))
  const groups = computed(() => vaultGroups(records.value))
  const summary = computed(() =>
    query.value.trim() ? `${visibleRecords.value.length} / ${records.value.length} 条` : `${records.value.length} 条`
  )

  /** 把 store 里的密钥状态刷一遍（密钥在别处被换过之后调） */
  async function refreshKey(): Promise<void> {
    const state = await vault.keyState()
    keyChecked.value = true
    if (!state.ok) {
      keyExists.value = false
      unlocked.value = false
      fingerprint.value = ''
      return
    }
    keyExists.value = state.data.exists
    unlocked.value = state.data.unlocked
    fingerprint.value = state.data.fingerprint
  }

  /** 读全部条目并铺到界面上。失败时如实报一句，**不清空已有列表**（免得闪一下全没了） */
  async function loadRecords(): Promise<boolean> {
    loading.value = true
    try {
      const loaded = await vault.load()
      if (!loaded.ok) {
        notifyFailure('读取保险库', loaded.error)
        return false
      }
      records.value = loaded.data.records
      unreadable.value = loaded.data.unreadable
      dropped.value = loaded.data.dropped
      updatedAt.value = loaded.data.updatedAt
      return true
    } finally {
      loading.value = false
    }
  }

  /** 同步配置。仓库那一段接受 `owner/repo`，也接受整条 gitee 地址 */
  function syncConfig(): GiteeConfig | null {
    const repo = parseRepo(settingsStore.settings.repo)
    if (!repo) return null
    return {
      owner: repo.owner,
      repo: repo.repo,
      branch: settingsStore.settings.branch.trim() || 'master',
      token: settingsStore.settings.token.trim()
    }
  }

  /**
   * 同步一轮。**失败时不抛**：这句话要落在工具带上（`syncNote`），
   * 因为用户点的是那一颗按钮，反馈就该出现在它旁边。
   */
  async function sync(options: { quiet?: boolean } = {}): Promise<boolean> {
    const config = syncConfig()
    if (!config) {
      if (!options.quiet) notifyFailure('同步', '先到设置里填同步仓库与令牌')
      return false
    }

    syncing.value = true
    try {
      const result = await vault.sync(config)
      if (!result.ok) {
        syncFailed.value = true
        syncNote.value = result.error
        if (!options.quiet) notifyFailure('同步', result.error)
        return false
      }

      records.value = result.data.records
      unreadable.value = result.data.unreadable
      dropped.value = result.data.dropped
      updatedAt.value = result.data.updatedAt
      keyMismatch.value = result.data.keyMismatch
      syncFailed.value = false
      syncNote.value = describeSync(result.data)
      return true
    } finally {
      syncing.value = false
    }
  }

  /** 启动时调一次：问密钥状态；已解锁就直接读条目 */
  async function init(): Promise<void> {
    await refreshKey()
    if (unlocked.value) {
      await loadRecords()
      // 配好了同步就悄悄拉一次：用户打开 App 看到的应当是最新的
      if (settingsStore.syncReady()) void sync({ quiet: true })
    }
  }

  async function createKey(replace = false): Promise<void> {
    creating.value = true
    try {
      const result = await vault.createKey(replace)
      if (!result.ok) {
        notifyFailure('创建保险库', result.error)
        return
      }
      fingerprint.value = result.data.fingerprint
      keyExists.value = true
      unlocked.value = true
      await loadRecords()
      notifySuccess('保险库已创建')
    } finally {
      creating.value = false
    }
  }

  async function importKeyText(text: string): Promise<boolean> {
    creating.value = true
    try {
      const result = await vault.importKey(text)
      if (!result.ok) {
        notifyFailure('导入密钥', result.error)
        return false
      }
      fingerprint.value = result.data.fingerprint
      keyExists.value = true
      unlocked.value = true
      await loadRecords()
      notifySuccess('密钥已导入')
      // 新设备上导入完应当立刻同步一次，把仓库里那些条目拉下来
      if (settingsStore.syncReady()) void sync({ quiet: true })
      return true
    } finally {
      creating.value = false
    }
  }

  /** 导出用的密钥串（没解锁时是 null）。界面拿它去复制 / 存文件 */
  function exportKeyString(): string | null {
    return vault.exportKeyString()
  }

  async function forgetKey(): Promise<void> {
    vault.forgetKey()
    keyExists.value = false
    unlocked.value = false
    fingerprint.value = ''
    records.value = []
    unreadable.value = 0
    dropped.value = 0
    updatedAt.value = 0
    syncNote.value = ''
    keyMismatch.value = false
    notifySuccess('本机密钥已清除')
  }

  async function unlock(): Promise<void> {
    const result = await vault.unlock()
    if (!result.ok) {
      notifyFailure('解锁', result.error)
      return
    }
    unlocked.value = true
    fingerprint.value = result.data.fingerprint
    await loadRecords()
  }

  function lock(): void {
    vault.lock()
    unlocked.value = false
    // **明文一起从内存里丢掉**：收起密码就是「屏幕上与内存里都没有」
    records.value = []
    unreadable.value = 0
    dropped.value = 0
  }

  /** 存一条（新增或改动）。返回是否成功 —— 弹框据此决定关不关 */
  async function saveEntry(id: string, entry: VaultEntry): Promise<boolean> {
    const result = await vault.save({ id, entry })
    if (!result.ok) {
      notifyFailure('保存', result.error)
      return false
    }

    // 就地替换那一条，不整份重读：重读会让卡片墙闪一下，而这条的正文我们手上就有
    const index = records.value.findIndex((record) => record.id === id)
    if (index >= 0) records.value[index] = result.data
    else records.value = [...records.value, result.data]

    updatedAt.value = Math.max(updatedAt.value, result.data.updatedAt)
    notifySuccess(index >= 0 ? '已保存' : '已添加')
    if (settingsStore.syncReady()) void sync({ quiet: true })
    return true
  }

  async function removeEntry(id: string): Promise<void> {
    const result = vault.remove(id)
    if (!result.ok) {
      notifyFailure('删除', result.error)
      return
    }
    records.value = records.value.filter((record) => record.id !== id)
    notifySuccess('已删除')
    if (settingsStore.syncReady()) void sync({ quiet: true })
  }

  return {
    // 状态
    keyChecked,
    keyExists,
    unlocked,
    fingerprint,
    records,
    unreadable,
    dropped,
    updatedAt,
    keyMismatch,
    query,
    loading,
    creating,
    syncing,
    syncNote,
    syncFailed,
    // 派生
    visibleRecords,
    sections,
    groups,
    summary,
    // 动作
    init,
    refreshKey,
    loadRecords,
    createKey,
    importKeyText,
    exportKeyString,
    forgetKey,
    unlock,
    lock,
    saveEntry,
    removeEntry,
    sync,
    syncConfig
  }
})