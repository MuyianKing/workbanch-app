/**
 * base64url（RFC 4648 §5）与字节之间的互转。
 *
 * 单独一个模块是因为三处都要用：密钥串（`key.ts`）、信封里的密文三件套（`crypto.ts`）、
 * Gitee 文件接口的 content 字段（`sync/gitee.ts`）—— 各写一份迟早会有一处忘了去掉 `=`。
 *
 * 走 `btoa` / `atob` 而不是手写查表：两个环境（WebView2 与 Node）都自带，且是原生实现。
 */

/**
 * 返回值写死 `Uint8Array<ArrayBuffer>` 而不是裸的 `Uint8Array`：后者的默认泛型参数是
 * `ArrayBufferLike`，而 WebCrypto 那几个参数要的是 `ArrayBufferView<ArrayBuffer>` ——
 * 裸类型在这里过不了类型检查（`SharedArrayBuffer` 那一支被排除掉了）。
 */
export function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'))
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

/** 标准 base64（带 `+/=`）—— Gitee 的文件接口要的是这一种，不是 base64url */
export function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

/** 字符串 → UTF-8 字节的 base64：给「把整个 vault.json 塞进 Gitee 的 content 字段」用 */
export function encodeUtf8Base64(text: string): string {
  return toBase64(new TextEncoder().encode(text))
}

/** `encodeUtf8Base64` 的反面：Gitee 回包里的 content 是**带换行的**标准 base64 */
export function decodeUtf8Base64(text: string): string {
  const binary = atob(text.replace(/\s/g, ''))
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return new TextDecoder().decode(bytes)
}