/**
 * 加解密的单测。
 *
 * 这一块是全项目最不能出错的地方：算式错一点点，后果是**另一台设备上一条都解不开**，
 * 而且看不出错在哪。所以除了「往返一致」，还要测几条边界 —— 换了密钥必须解不开、
 * 同一个信封被改一个字节必须解不开（GCM 的认证标签）。
 */

import { describe, expect, it } from 'vitest'
import { createVaultKey, publicKeyOf } from './key'
import { open, seal } from './crypto'
import type { VaultEntry, VaultItem } from './file'

const entry: VaultEntry = {
  name: '宽带账号',
  password: 'p@ssw0rd-注意符号',
  notes: '第二段验证码在备用手机里',
  group: '家庭'
}

describe('seal / open', () => {
  it('同一把密钥封了能解回原样', async () => {
    const key = await createVaultKey()
    const sealed = await seal(publicKeyOf(key), entry)

    const item: VaultItem = { id: 'a', updatedAt: 1, by: 'dev', ...sealed }
    expect(await open(key, item)).toEqual(entry)
  })

  it('封的时候只有公钥也成立（「能加不能解」的那一半）', async () => {
    const key = await createVaultKey()
    // 只传公钥：没有 d 也能封
    const sealed = await seal(publicKeyOf(key), entry)
    expect(sealed.ct.length).toBeGreaterThan(0)
    expect(sealed.pub.length).toBeGreaterThan(0)
    expect(sealed.iv.length).toBeGreaterThan(0)
  })

  it('同一条正文封两次，密文完全不同（一次一密）', async () => {
    const key = await createVaultKey()
    const first = await seal(publicKeyOf(key), entry)
    const second = await seal(publicKeyOf(key), entry)

    expect(first.ct).not.toBe(second.ct)
    expect(first.pub).not.toBe(second.pub)
    // 但都能解开
    expect(await open(key, { id: 'a', updatedAt: 1, by: 'd', ...first })).toEqual(entry)
    expect(await open(key, { id: 'a', updatedAt: 1, by: 'd', ...second })).toEqual(entry)
  })

  it('换了密钥就解不开 —— 这正是「没有私钥读不出来」', async () => {
    const mine = await createVaultKey()
    const other = await createVaultKey()
    const sealed = await seal(publicKeyOf(mine), entry)

    await expect(open(other, { id: 'a', updatedAt: 1, by: 'd', ...sealed })).rejects.toThrow()
  })

  it('密文被改一个字节就解不开（GCM 的认证标签拦下来）', async () => {
    const key = await createVaultKey()
    const sealed = await seal(publicKeyOf(key), entry)

    // 动 ct 的第一个字符：base64url 里换成一个必定不同的字符
    const tampered = (sealed.ct[0] === 'A' ? 'B' : 'A') + sealed.ct.slice(1)
    await expect(
      open(key, { id: 'a', updatedAt: 1, by: 'd', pub: sealed.pub, iv: sealed.iv, ct: tampered })
    ).rejects.toThrow()
  })

  it('信封里缺密文时给一句人话，而不是一个底层的 TypeError', async () => {
    const key = await createVaultKey()
    await expect(open(key, { id: 'a', updatedAt: 1, by: 'd' })).rejects.toThrow('这条记录里没有密文')
  })

  it('正文经过收敛：超长与多余空白都按 `sanitizeVaultEntry` 的口径', async () => {
    const key = await createVaultKey()
    const sealed = await seal(publicKeyOf(key), { ...entry, group: '  家庭  ' })
    const opened = await open(key, { id: 'a', updatedAt: 1, by: 'd', ...sealed })
    expect(opened.group).toBe('家庭')
  })
})