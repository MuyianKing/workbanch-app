/**
 * 条目正文的加解密（ECIES）—— 与 Workbench 逐字节算法兼容。
 *
 * **为什么是这套密码学**：一把 ECDH P-256 密钥对，**私钥只住在本机**。每条条目单独走一次 ECIES：
 * 现生成一把临时密钥对 → 与主公钥做 ECDH → HKDF-SHA256 推出 AES-256-GCM 的密钥 → 加密条目正文。
 * 于是「能加不能解」是真的成立（有公钥就能往里写，没有私钥就读不出来），而仓库里那份从头到尾只有密文。
 *
 * **为什么用 WebCrypto 而不是别的实现**：WebView2 与 Node 都自带一套标准的 WebCrypto，
 * 而引任何一套 JS 密码学库（crypto-js / node-forge …）都会往产物里塞进成片的代码，
 * 且格式未必与桌面端对得上。约束见 AGENTS.md 第 1 节。
 *
 * `seal` 只要有公钥就能做，`open` 必须要私钥。
 */

import { fromBase64Url, toBase64Url } from './base64'
import { CURVE, publicKeyOf, type VaultPrivateKey, type VaultPublicKey } from './key'
import type { VaultEntry, VaultItem, VaultRecord } from './file'
import { sanitizeVaultEntry } from './file'

/** HKDF 的 info：把这条曲线上的共享秘密收敛成「只属于本应用这一版保险库」的密钥 */
const HKDF_INFO = 'workbench-vault-v1'

const AES = 'AES-GCM'

/** 两边各自算一次这个：ECDH 出共享秘密，再 HKDF 收敛成一把 AES-256-GCM 密钥 */
async function sharedAesKey(privateKey: CryptoKey, publicKey: CryptoKey): Promise<CryptoKey> {
  const bits = await crypto.subtle.deriveBits({ name: 'ECDH', public: publicKey }, privateKey, 256)
  const material = await crypto.subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      // 盐与 info 都是常量：这里没有「同一把密钥加密多条消息要各自域分离」的需求，
      // 每条条目的密钥来自**每次现场生成的临时密钥对**，本身就已经一次一密
      salt: new Uint8Array(32),
      info: new TextEncoder().encode(HKDF_INFO)
    },
    material,
    { name: AES, length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
}

/**
 * 一条信封里属于密文的那三项。单独一个类型（而不是 `Omit<VaultItem, …>`）是为了让它们是必填的：
 * 那个 `Omit` 会把 `pub` / `iv` / `ct` 的可选性一起带过来，于是每个用它的地方都得多写一次非空判断。
 */
export interface SealedEntry {
  pub: string
  iv: string
  ct: string
}

/**
 * 把一条正文封成信封：**只要有公钥就能做，不需要私钥**。
 * 临时密钥对是这次现生成的，用完就丢 —— 于是同一条正文加密两次得到的密文完全不同。
 */
export async function seal(key: VaultPublicKey, entry: VaultEntry): Promise<SealedEntry> {
  const publicKey = await crypto.subtle.importKey('jwk', publicKeyOf(key), CURVE, false, [])
  const ephemeral = await crypto.subtle.generateKey(CURVE, true, ['deriveBits'])

  const aes = await sharedAesKey(ephemeral.privateKey, publicKey)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const plaintext = new TextEncoder().encode(JSON.stringify(sanitizeVaultEntry(entry)))
  const ct = await crypto.subtle.encrypt({ name: AES, iv }, aes, plaintext)
  const pub = new Uint8Array(await crypto.subtle.exportKey('raw', ephemeral.publicKey))

  return { pub: toBase64Url(pub), iv: toBase64Url(iv), ct: toBase64Url(new Uint8Array(ct)) }
}

/**
 * 解开一条信封。**要私钥**。
 *
 * 抛错是正常的返回方式：密钥对不上、文件被改过一个字节（GCM 的认证标签会拦下）、
 * 或者那一段 base64 根本不是密文，都在这里失败 —— 调用方按「这一条读不出来」记一笔，
 * 让其余条目照常显示，而不是整份保险库打不开。
 */
export async function open(privateKey: VaultPrivateKey, item: VaultItem): Promise<VaultEntry> {
  if (!item.pub || !item.iv || !item.ct) throw new Error('这条记录里没有密文')

  // 这一处**故意**整个摊开：这里要的正是私钥（`d` 得带上），摊开才对。
  // 反过来，收公钥的那几处必须走 publicKeyOf()，理由见它的说明
  const key = await crypto.subtle.importKey('jwk', { ...privateKey }, CURVE, false, ['deriveBits'])
  const ephemeral = await crypto.subtle.importKey('raw', fromBase64Url(item.pub), CURVE, false, [])
  const aes = await sharedAesKey(key, ephemeral)

  const plaintext = await crypto.subtle.decrypt(
    { name: AES, iv: fromBase64Url(item.iv) },
    aes,
    fromBase64Url(item.ct)
  )
  const parsed: unknown = JSON.parse(new TextDecoder().decode(new Uint8Array(plaintext)))
  return sanitizeVaultEntry(parsed)
}

/** 读哪几条读不出来：返回 id 清单，界面据此如实说「有 N 条解不开」 */
export async function openAll(
  privateKey: VaultPrivateKey,
  file: { items: readonly VaultItem[] }
): Promise<{ records: VaultRecord[]; failed: string[] }> {
  const records: VaultRecord[] = []
  const failed: string[] = []

  for (const item of file.items) {
    if (item.deleted) continue
    try {
      const entry = await open(privateKey, item)
      records.push({ ...entry, id: item.id, updatedAt: item.updatedAt, by: item.by })
    } catch {
      failed.push(item.id)
    }
  }

  return { records, failed }
}