/**
 * 统一的「成功 / 失败」返回。
 *
 * **为什么不用异常**：这个应用里绝大多数失败都是**预期内的**（令牌不对、仓库里还没有文件、
 * 某一条解不开），它们要变成界面上一句话，而不是一个让控制流跳到别处的 throw。
 * 异常只留给真正的意外（WebCrypto 自己出的错）。
 */

export type Result<T> = { ok: true; data: T } | { ok: false; error: string }

export function ok<T>(data: T): Result<T> {
  return { ok: true, data }
}

export function fail<T = never>(error: string): Result<T> {
  return { ok: false, error }
}

/** 把任意 catch 到的东西变成一句能上屏的话 */
export function reasonOf(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'string' && error) return error
  return '未知原因'
}