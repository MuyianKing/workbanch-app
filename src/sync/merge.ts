/**
 * 跨设备合并 —— **这一步就是同步的全部**，且必须是纯函数。
 *
 * 两台设备各自拿 (自己的, 对方的) 调一次，算出来的必须是同一份内容，否则就会来回覆盖、
 * 永远收敛不了。所以合并规则里不能有任何「以我为准」的倾向：只认 `updatedAt` 与 `by`
 * 这两个明文事实（见 AGENTS.md 第 3 节）。
 *
 * 三条：
 *  - **并集**：只在一边出现过的 id 直接留下；
 *  - **同 id 取新**：`updatedAt` 大的赢，撞上时 `by` 大的赢；
 *  - **墓碑不复活**：删除留下的空壳照常参与比较 —— 删得比改得晚就还是删。
 *    墓碑因此会一直留在文件里（约 90 字节）。不清理是**故意的**：清掉之后，
 *    一台离线很久的设备再回来时，本地那条老记录就成了「只有一边有」的并集项，
 *    于是被原样推回去 —— 用户看到的是删掉的密码自己回来了。
 *
 * 输出的顺序按 id 排：顺序不确定的话，两台设备合并完的文件会有没意义的字节差异，
 * 表现成仓库里堆出一串「什么都没改」的提交。
 *
 * **与 Workbench 的 `packages/vault/src/vault.ts` 逐条一致**，改动要同时改两边。
 */

import type { VaultItem } from '../vault/file'

/** 同一个 id 上取新的那一份：先比时间，再比设备 id（保证两台设备算出同一个赢家） */
export function pickNewer(a: VaultItem, b: VaultItem): VaultItem {
  if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt ? a : b
  if (a.by !== b.by) return a.by > b.by ? a : b
  // 时间与设备都撞上：只可能是同一台设备在同一毫秒写下来的同一份内容，留本地那份即可
  return a
}

export function mergeVaultItems(
  local: readonly VaultItem[],
  remote: readonly VaultItem[]
): VaultItem[] {
  const merged = new Map<string, VaultItem>()

  for (const item of local) merged.set(item.id, item)
  for (const item of remote) {
    const existing = merged.get(item.id)
    merged.set(item.id, existing ? pickNewer(existing, item) : item)
  }

  return [...merged.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}