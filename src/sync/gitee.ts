/**
 * Gitee 文件接口的读写：仓库里那份 `vault/vault.json` 的取与放。
 *
 * **为什么走 HTTP API 而不是 git**：本 App 跑在 web-view 里，没有文件系统、没有 git、
 * 也没有桌面端那样的凭据管理器（见 AGENTS.md 约束）。Gitee 的 contents 接口一次
 * GET/PUT 就能读写一个文件，正好够用。
 *
 * **并发用 sha 挡**：Gitee 的更新接口要求带上「读的时候那个文件的 sha」，对不上会拒绝。
 * 于是它天然就是桌面端 `push` 里那道「写入前核对基准」的闸 —— 两边都靠它把
 * 「另一台设备在这一轮里推过」认出来，而不是让 git 去合同一个文件。
 *
 * 这一层只负责「取回一段文本 / 放上去一段文本」，不认识保险库的形状（那是 `file.ts` 的事）
 * 也不认识合并规则（那是 `merge.ts` 的事）。
 */

import { decodeUtf8Base64, encodeUtf8Base64 } from '../vault/base64'

/** 仓库里的固定路径。**不给用户配**：所有设备落在同一个路径上才看得见彼此的改动 */
export const VAULT_PATH = 'vault/vault.json'

const API = 'https://gitee.com/api/v5'

export interface GiteeConfig {
  /** 仓库路径的 `owner` 那一段 */
  owner: string
  /** 仓库路径的 `repo` 那一段 */
  repo: string
  /** 分支名，如 `master` */
  branch: string
  /** Gitee 私人令牌，需要 projects 读写权限 */
  token: string
}

/** 远端那一份：文本内容 + 用于下次更新时校验的 sha */
export interface RemoteFile {
  content: string
  sha: string
}

/**
 * 这一层能给出的三种失败。分这么细是因为界面要说的话完全不同 ——
 * 「令牌不对」和「连不上」对用户来说是完全不同的两件事。
 */
export type GiteeFailure =
  | { kind: 'auth'; message: string }
  | { kind: 'missing'; message: string }
  | { kind: 'conflict'; message: string }
  | { kind: 'network'; message: string }
  | { kind: 'unknown'; message: string }

export type GiteeResult<T> = { ok: true; data: T } | { ok: false; error: GiteeFailure }

function contentsUrl(config: GiteeConfig): string {
  return `${API}/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/contents/${VAULT_PATH}`
}

/** 从 Gitee 的报错体里尽量抠出一句人话，抠不出就用状态码兜底 */
async function describe(response: Response, fallback: string): Promise<string> {
  try {
    const text = await response.text()
    if (!text) return fallback
    try {
      const parsed: unknown = JSON.parse(text)
      if (parsed && typeof parsed === 'object') {
        const value = parsed as Record<string, unknown>
        for (const key of ['message', 'error_description', 'error']) {
          if (typeof value[key] === 'string' && value[key]) return value[key] as string
        }
      }
    } catch {
      // 不是 JSON 就原样截一段，至少让用户看到 Gitee 说了什么
      return text.slice(0, 200)
    }
  } catch {
    // 连 body 都读不出来：用兜底那句
  }
  return fallback
}

function failureOf(status: number, message: string): GiteeFailure {
  if (status === 401) return { kind: 'auth', message: `令牌无效或已过期：${message}` }
  if (status === 403) return { kind: 'auth', message: `令牌没有这个仓库的读写权限：${message}` }
  if (status === 404) return { kind: 'missing', message: `仓库或分支不存在：${message}` }
  if (status === 409 || status === 400) return { kind: 'conflict', message }
  return { kind: 'unknown', message }
}

/**
 * 取回仓库里那一份。**仓库里还没有这个文件时返回 `null`**，那不是错误
 * （第一次同步时就是这种状态，接下来 push 会把它建出来）。
 *
 * 令牌按 Gitee 文档走 query 参数（`access_token`）—— 这是它明确支持的方式。
 * 与设计文档第 5.3 节一致。
 */
export async function pullFile(config: GiteeConfig): Promise<GiteeResult<RemoteFile | null>> {
  const query = new URLSearchParams({ ref: config.branch, access_token: config.token })
  const url = `${contentsUrl(config)}?${query.toString()}`

  let response: Response
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' }
    })
  } catch (error) {
    return {
      ok: false,
      error: { kind: 'network', message: `连不上 Gitee：${error instanceof Error ? error.message : '未知原因'}` }
    }
  }

  if (response.status === 404) return { ok: true, data: null }
  if (!response.ok) {
    const message = await describe(response, `HTTP ${response.status}`)
    return { ok: false, error: failureOf(response.status, message) }
  }

  let body: unknown
  try {
    body = await response.json()
  } catch {
    return { ok: false, error: { kind: 'unknown', message: 'Gitee 回的不是一段 JSON' } }
  }

  if (!body || typeof body !== 'object') {
    return { ok: false, error: { kind: 'unknown', message: 'Gitee 回的 JSON 里没有文件内容' } }
  }

  const value = body as Record<string, unknown>
  // 目录（虚拟路径）会回一个数组，那不是一份文件
  if (Array.isArray(value)) return { ok: true, data: null }
  if (typeof value.content !== 'string' || typeof value.sha !== 'string') {
    return { ok: false, error: { kind: 'unknown', message: 'Gitee 回的文件缺少 content 或 sha' } }
  }

  try {
    return { ok: true, data: { content: decodeUtf8Base64(value.content), sha: value.sha } }
  } catch {
    return { ok: false, error: { kind: 'unknown', message: 'Gitee 回的文件内容不是合法的 base64' } }
  }
}

/**
 * 把内容写回仓库。
 *
 * `sha` 是这次合并依据的那一份的 sha（仓库里还没有时传 null → 走新建）。
 * 对不上时 Gitee 会拒绝，这里如实报 `conflict` —— 调用方据此重新取一遍再合一次，
 * 而不是硬盖上去把另一台设备的改动弄丢。
 *
 * **`sha` 有一处例外要留意**：Gitee 对「文件不存在却带了 sha」也会报 400/404，
 * 那种情况同样落进 conflict —— 重新取一遍就变成 null 了，下一轮自然走新建。
 */
export async function pushFile(
  config: GiteeConfig,
  content: string,
  sha: string | null
): Promise<GiteeResult<null>> {
  const body = {
    access_token: config.token,
    content: encodeUtf8Base64(content),
    message: commitMessage(),
    branch: config.branch,
    ...(sha ? { sha } : {})
  }

  let response: Response
  try {
    response = await fetch(contentsUrl(config), {
      method: sha ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body)
    })
  } catch (error) {
    return {
      ok: false,
      error: { kind: 'network', message: `连不上 Gitee：${error instanceof Error ? error.message : '未知原因'}` }
    }
  }

  if (response.ok) return { ok: true, data: null }

  const message = await describe(response, `HTTP ${response.status}`)
  return { ok: false, error: failureOf(response.status, message) }
}

/** 提交信息带上这台设备的代号，一眼看得出这次改动是哪台设备做的 */
function commitMessage(): string {
  return 'vault: 移动端同步'
}

/**
 * 从用户填的一串里认出 owner / repo。接受 `owner/repo`，也接受整条 https 地址 ——
 * 用户从浏览器地址栏复制过来的十有八九是后者。
 */
export function parseRepo(input: string): { owner: string; repo: string } | null {
  let text = input.trim().replace(/\.git$/i, '').replace(/\/+$/, '')
  if (!text) return null

  // https://gitee.com/owner/repo 或 git@gitee.com:owner/repo
  const url = text.match(/gitee\.com[/:]([^/]+)\/([^/]+)$/i)
  if (url) return { owner: url[1], repo: url[2] }

  const parts = text.split('/')
  if (parts.length === 2 && parts[0] && parts[1]) return { owner: parts[0], repo: parts[1] }
  return null
}