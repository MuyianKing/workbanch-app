/**
 * 保险库密钥：形状、编解码、指纹。
 *
 * **与 Workbench 的 `packages/vault/src/vault.ts` 是同一份格式** —— 密钥串前缀、JWK 字段名、
 * 指纹算法都必须逐字节一致，否则两边互相导入时只会得到一句「这段内容不是一把保险库密钥」。
 * 改动这里的任何一处，都要同时改 Workbench 那一侧（见 AGENTS.md 第 2 节）。
 *
 * 密钥的**去向**两边不同，但形状相同：桌面端存进 Windows 凭据管理器，本 App 存 localStorage
 * （用户确认的方案，见 AGENTS.md 第 4 节）。
 */

import { fromBase64Url, toBase64Url } from './base64'

/** 导出密钥串的前缀：粘回来时先认这个头，别把别的 base64 当成密钥 */
export const KEY_PREFIX = 'workbench-vault-v1.'

export const CURVE = { name: 'ECDH', namedCurve: 'P-256' } as const

/** 公钥的 JWK：只有这三个坐标，没有 d（私钥那一段） */
export interface VaultPublicKey {
  kty: 'EC'
  crv: 'P-256'
  x: string
  y: string
}

/** 私钥的 JWK：公钥那三个坐标加一个 d。**只在本机内存与该设备的存储之间流转** */
export interface VaultPrivateKey extends VaultPublicKey {
  d: string
}

/** 现生成一把保险库密钥。私钥可导出（要存起来、也要导出到别的机器） */
export async function createVaultKey(): Promise<VaultPrivateKey> {
  const pair = await crypto.subtle.generateKey(CURVE, true, ['deriveBits'])
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey)
  return {
    kty: 'EC',
    crv: 'P-256',
    x: jwk.x ?? '',
    y: jwk.y ?? '',
    d: jwk.d ?? ''
  }
}

/**
 * 从私钥上摘出公钥那一段：写进文件、也交给 `seal` 用。
 *
 * 必须逐字段拼出来，**不能把入参整个摊开**：`VaultPrivateKey` 在结构上是
 * `VaultPublicKey` 的子集，所以一把私钥传得进所有收公钥的函数，而带着 `d` 的 JWK
 * 会被 WebCrypto 当成私钥 —— 私钥不接受空 usages，于是报的是
 * 「Usages cannot be empty when importing a private key」，与「密钥不对」看着毫无关系。
 * 收公钥的那几处一律先过这一道。
 */
export function publicKeyOf(key: VaultPublicKey): VaultPublicKey {
  return { kty: 'EC', crv: 'P-256', x: key.x, y: key.y }
}

/** 形状对不对。读存储 / 读用户粘贴的内容时先过这一关，别把半截 JWK 拿去 import */
export function isVaultPrivateKey(value: unknown): value is VaultPrivateKey {
  if (typeof value !== 'object' || value === null) return false
  const key = value as Record<string, unknown>
  return (
    key.kty === 'EC' &&
    key.crv === 'P-256' &&
    typeof key.x === 'string' &&
    key.x.length > 0 &&
    typeof key.y === 'string' &&
    key.y.length > 0 &&
    typeof key.d === 'string' &&
    key.d.length > 0
  )
}

export function isVaultPublicKey(value: unknown): value is VaultPublicKey {
  if (typeof value !== 'object' || value === null) return false
  const key = value as Record<string, unknown>
  return (
    key.kty === 'EC' &&
    key.crv === 'P-256' &&
    typeof key.x === 'string' &&
    key.x.length > 0 &&
    typeof key.y === 'string' &&
    key.y.length > 0
  )
}

/**
 * 把密钥打成一段可以抄到另一台设备的串（导出的密钥文件里存的就是它）。
 *
 * 前缀是给「粘回来」那一刻用的：先认这个头，才谈得上后面的解析，
 * 而不是把随便一段 base64 当成密钥去 import 然后报一句看不懂的错。
 */
export function encodeKeyString(key: VaultPrivateKey): string {
  return KEY_PREFIX + toBase64Url(new TextEncoder().encode(JSON.stringify(key)))
}

/** `encodeKeyString` 的反面：认不出来一律 null，调用方据此给一句人话 */
export function parseKeyString(text: string): VaultPrivateKey | null {
  const trimmed = text.trim()
  if (!trimmed.startsWith(KEY_PREFIX)) return null
  try {
    const parsed: unknown = JSON.parse(
      new TextDecoder().decode(fromBase64Url(trimmed.slice(KEY_PREFIX.length)))
    )
    return isVaultPrivateKey(parsed) ? parsed : null
  } catch {
    return null
  }
}

/** 文件里记的那把公钥与手上这把是不是同一把（坐标逐字比，不做任何归一化） */
export function sameVaultKey(file: { key: VaultPublicKey }, key: VaultPublicKey): boolean {
  return file.key.x === key.x && file.key.y === key.y
}

/**
 * 公钥的指纹（`A1B2-C3D4-E5F6`），用来核对两台设备拿的是不是同一把密钥。
 *
 * 取公钥原始点（65 字节）的 SHA-256 前 6 字节 —— 给的是公钥，不是密钥本身，
 * 所以可以放心上屏：它反过来推不出私钥，两台设备对不上时也只说明「该重新导出一次」。
 */
export async function publicKeyFingerprint(key: VaultPublicKey): Promise<string> {
  const imported = await crypto.subtle.importKey('jwk', publicKeyOf(key), CURVE, true, [])
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', imported))
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', raw))
  const hex = Array.from(digest.slice(0, 6), (byte) => byte.toString(16).padStart(2, '0')).join('')
  return hex.toUpperCase().replace(/(.{4})(?=.)/g, '$1-')
}