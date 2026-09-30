/**
 * 密钥串与文件解析的单测。
 *
 * 这两处都是**与桌面端交接的关口**：密钥串认不出来，用户拿到的是一句「这不是密钥」；
 * 文件解析认不出来，用户拿到的是一整份保险库读不了。所以边界值比正常值更重要。
 */

import { describe, expect, it } from 'vitest'
import {
  createVaultKey,
  encodeKeyString,
  isVaultPrivateKey,
  parseKeyString,
  publicKeyFingerprint,
  sameVaultKey
} from './key'
import { emptyVaultFile, parseVaultFile, sanitizeVaultEntry, vaultEntryProblem } from './file'

describe('密钥串', () => {
  it('编了再解，拿到的是同一把（坐标与 d 逐字段相同）', async () => {
    const key = await createVaultKey()
    const parsed = parseKeyString(encodeKeyString(key))

    expect(parsed).not.toBeNull()
    expect(parsed!.x).toBe(key.x)
    expect(parsed!.y).toBe(key.y)
    expect(parsed!.d).toBe(key.d)
  })

  it('串上带前缀，一眼看得出这是什么', async () => {
    const text = encodeKeyString(await createVaultKey())
    expect(text.startsWith('workbench-vault-v1.')).toBe(true)
  })

  it('前缀不对一律 null —— 不把随便一段 base64 拿去 import', () => {
    expect(parseKeyString('随便一段文字')).toBeNull()
    expect(parseKeyString('')).toBeNull()
    expect(parseKeyString('workbench-vault-v1.这不是base64')).toBeNull()
  })

  it('前缀对但内容不是一把密钥时也是 null', () => {
    const payload = btoa(JSON.stringify({ kty: 'EC', crv: 'P-256', x: 'a' }))
    expect(parseKeyString(`workbench-vault-v1.${payload}`)).toBeNull()
  })

  it('前后有空白也认得出来（用户粘贴时常常带上换行）', async () => {
    const text = encodeKeyString(await createVaultKey())
    expect(parseKeyString(`  \n${text}\n  `)).not.toBeNull()
  })

  it('私钥的形状校验卡住半截 JWK（少了 d 的不算）', async () => {
    const key = await createVaultKey()
    expect(isVaultPrivateKey(key)).toBe(true)
    expect(isVaultPrivateKey({ ...key, d: '' })).toBe(false)
    expect(isVaultPrivateKey({ kty: 'EC', crv: 'P-256', x: key.x, y: key.y })).toBe(false)
  })

  it('指纹是稳定的短串，能用来核对两台设备拿的是不是同一把', async () => {
    const key = await createVaultKey()
    const first = await publicKeyFingerprint(key)
    const second = await publicKeyFingerprint(key)

    expect(first).toBe(second)
    // A1B2-C3D4-E5F6：12 个十六进制字符，中间两道短横
    expect(first).toMatch(/^[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/)
  })

  it('两把不同的密钥指纹不同', async () => {
    const a = await publicKeyFingerprint(await createVaultKey())
    const b = await publicKeyFingerprint(await createVaultKey())
    expect(a).not.toBe(b)
  })
})

describe('文件解析', () => {
  it('空文件认得出来，不是错误', async () => {
    const key = await createVaultKey()
    const parsed = parseVaultFile(emptyVaultFile(key))
    expect(parsed).not.toBeNull()
    expect(parsed!.file.items).toEqual([])
    expect(parsed!.dropped).toBe(0)
  })

  it('不是一份保险库文件时返回 null（与「文件不存在」是两回事）', () => {
    expect(parseVaultFile(null)).toBeNull()
    expect(parseVaultFile('一段文字')).toBeNull()
    expect(parseVaultFile({ version: 1 })).toBeNull()
    expect(parseVaultFile({ version: 1, key: { kty: 'EC' }, items: [] })).toBeNull()
  })

  it('单条坏掉只丢那一条，其余照常读出来', async () => {
    const key = await createVaultKey()
    const parsed = parseVaultFile({
      version: 1,
      key: { kty: 'EC', crv: 'P-256', x: key.x, y: key.y },
      items: [
        { id: 'good', updatedAt: 1, by: 'dev', pub: 'p', iv: 'i', ct: 'c' },
        { id: '', updatedAt: 1, by: 'dev', pub: 'p', iv: 'i', ct: 'c' },
        { id: 'no-time', by: 'dev', pub: 'p', iv: 'i', ct: 'c' },
        { id: 'no-ct', updatedAt: 1, by: 'dev', pub: 'p', iv: 'i' }
      ]
    })

    expect(parsed).not.toBeNull()
    expect(parsed!.file.items.map((entry) => entry.id)).toEqual(['good'])
    expect(parsed!.dropped).toBe(3)
  })

  it('墓碑不需要密文三件套', async () => {
    const key = await createVaultKey()
    const parsed = parseVaultFile({
      version: 1,
      key: { kty: 'EC', crv: 'P-256', x: key.x, y: key.y },
      items: [{ id: 'gone', updatedAt: 5, by: 'dev', deleted: true }]
    })
    expect(parsed!.file.items[0].deleted).toBe(true)
    expect(parsed!.dropped).toBe(0)
  })

  it('读出来的条目按 id 排好（两台设备看到的顺序一样）', async () => {
    const key = await createVaultKey()
    const parsed = parseVaultFile({
      version: 1,
      key: { kty: 'EC', crv: 'P-256', x: key.x, y: key.y },
      items: [
        { id: 'zzz', updatedAt: 1, by: 'd', pub: 'p', iv: 'i', ct: 'c' },
        { id: 'aaa', updatedAt: 1, by: 'd', pub: 'p', iv: 'i', ct: 'c' }
      ]
    })
    expect(parsed!.file.items.map((entry) => entry.id)).toEqual(['aaa', 'zzz'])
  })
})

describe('条目正文的收敛', () => {
  it('名字那一栏认旧字段名 title，别让老记录变成一张没字的卡片', () => {
    expect(sanitizeVaultEntry({ title: '宽带' }).name).toBe('宽带')
  })

  it('分组去掉首尾空白 —— `开发 ` 与 `开发` 必须是同一组', () => {
    expect(sanitizeVaultEntry({ name: 'a', group: ' 开发 ' }).group).toBe('开发')
  })

  it('超长字段被截断（密文里不该出现没边的东西）', () => {
    expect(sanitizeVaultEntry({ name: 'x'.repeat(300) }).name).toHaveLength(200)
    expect(sanitizeVaultEntry({ name: 'a', notes: 'x'.repeat(6000) }).notes).toHaveLength(5000)
  })

  it('名字是唯一的必填项', () => {
    expect(vaultEntryProblem({ name: '', password: '', notes: '', group: '' })).toBe('请填一个名字')
    expect(vaultEntryProblem({ name: '  ', password: '', notes: '', group: '' })).toBe('请填一个名字')
    expect(vaultEntryProblem({ name: '宽带', password: '', notes: '', group: '' })).toBeNull()
  })
})

describe('sameVaultKey', () => {
  it('逐坐标比，不做归一化', async () => {
    const key = await createVaultKey()
    const file = { key: { kty: 'EC' as const, crv: 'P-256' as const, x: key.x, y: key.y } }
    expect(sameVaultKey(file, key)).toBe(true)
    expect(sameVaultKey({ key: { ...file.key, x: 'other' } }, key)).toBe(false)
  })
})