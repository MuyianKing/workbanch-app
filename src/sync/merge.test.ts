/**
 * 合并规则的单测。
 *
 * 这一块的关键不是「结果对不对」，而是**两台设备各自算一次必须得到同一份内容** ——
 * 做不到的话两边会来回覆盖、永远收敛不了。所以每条用例都从「两个方向的输入」检查。
 */

import { describe, expect, it } from 'vitest'
import { mergeVaultItems } from './merge'
import type { VaultItem } from '../vault/file'

function item(id: string, updatedAt: number, by = 'dev-a', extra: Partial<VaultItem> = {}): VaultItem {
  return { id, updatedAt, by, pub: `p-${id}`, iv: `i-${id}`, ct: `c-${id}`, ...extra }
}

function tombstone(id: string, updatedAt: number, by = 'dev-a'): VaultItem {
  return { id, updatedAt, by, deleted: true }
}

describe('mergeVaultItems', () => {
  it('并集：只在一边出现过的 id 都留下', () => {
    const merged = mergeVaultItems([item('aaa', 100)], [item('bbb', 200)])
    expect(merged.map((entry) => entry.id)).toEqual(['aaa', 'bbb'])
  })

  it('同 id 取 updatedAt 大的那份', () => {
    const merged = mergeVaultItems([item('aaa', 100, 'dev-a')], [item('aaa', 300, 'dev-b')])
    expect(merged).toHaveLength(1)
    expect(merged[0].updatedAt).toBe(300)
    expect(merged[0].by).toBe('dev-b')
  })

  it('时间撞上时按设备 id 破平 —— 反过来喂进去也是同一个赢家', () => {
    const a = item('aaa', 100, 'dev-a', { ct: 'from-a' })
    const b = item('aaa', 100, 'dev-b', { ct: 'from-b' })

    const forward = mergeVaultItems([a], [b])
    const backward = mergeVaultItems([b], [a])

    expect(forward).toEqual(backward)
    expect(forward[0].by).toBe('dev-b')
  })

  it('墓碑不复活：删得比改得晚就还是删', () => {
    const merged = mergeVaultItems([item('aaa', 100)], [tombstone('aaa', 200)])
    expect(merged[0].deleted).toBe(true)
  })

  it('墓碑不复活：改得比删得晚就活过来（用户确实又改了一次）', () => {
    const merged = mergeVaultItems([tombstone('aaa', 100)], [item('aaa', 200)])
    expect(merged[0].deleted).toBeUndefined()
    expect(merged[0].updatedAt).toBe(200)
  })

  it('输出按 id 升序 —— 顺序不定会让仓库里堆出「什么都没改」的提交', () => {
    const merged = mergeVaultItems(
      [item('ccc', 1), item('aaa', 1)],
      [item('bbb', 1), item('aaa', 2)]
    )
    expect(merged.map((entry) => entry.id)).toEqual(['aaa', 'bbb', 'ccc'])
  })

  it('两个方向的输入算出同一份内容（这是同步能收敛的全部依据）', () => {
    const local = [item('aaa', 100, 'dev-a'), item('bbb', 50, 'dev-a'), tombstone('ddd', 10, 'dev-a')]
    const remote = [item('aaa', 90, 'dev-b'), item('ccc', 70, 'dev-b'), tombstone('ddd', 20, 'dev-b')]

    expect(mergeVaultItems(local, remote)).toEqual(mergeVaultItems(remote, local))
  })

  it('空的一侧等于原样返回（首次同步就是这种状态）', () => {
    const local = [item('aaa', 100)]
    expect(mergeVaultItems(local, [])).toEqual(mergeVaultItems([], local))
  })
})