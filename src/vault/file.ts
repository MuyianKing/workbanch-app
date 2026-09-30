/**
 * 保险库文件：条目模型、文件信封、解析与生成。
 *
 * **它是一个密码备忘**：一条记录就是「名字 + 密码 + 备注 + 分组」四样，界面上一张卡片。
 * 没有用户名 / 网址那一套字段，也不生成口令 —— 多一个字段就多一份要填的东西，
 * 而这几样本来就是随手记下的东西（见 `VaultEntry`）。
 *
 * **磁盘上（以及仓库里）的一条记录：信封是明文，正文是密文。**
 * 明文那几项不是不小心漏出去的 —— 跨设备合并要在没有密钥的情况下也能算出同一个结果：
 * 认身份靠 `id`、判新旧靠 `updatedAt`、破平靠 `by`、认删除靠 `deleted`。
 * 少了任何一项，两台机器就会各执一词（一个说该留、一个说该删），而那需要人工去合。
 *
 * 格式与 Workbench 的 `packages/vault/src/vault.ts` 冻结兼容，见 AGENTS.md 第 2 节。
 */

import { isVaultPublicKey, publicKeyOf, type VaultPublicKey } from './key'
import { mergeVaultItems } from '../sync/merge'

/** 文件格式版本。改了信封结构才动它，动的时候要在 parseVaultFile 里补一条迁移 */
export const VAULT_VERSION = 1

/**
 * 磁盘上（以及仓库里）的一条记录：**信封是明文，正文是密文**。
 */
export interface VaultItem {
  /** 条目的稳定身份，从建出来到删掉都不变 —— 合并时唯一靠得住的东西 */
  id: string
  /** 最后改动时刻（毫秒）。跨设备合并判新旧就靠它 */
  updatedAt: number
  /** 最后改动的设备 id。时间撞上时用它破平 */
  by: string
  /** 墓碑：这一条已经被删了。只留个空壳，好让别的设备别把它复活 */
  deleted?: true
  /** 下面三项是密文，墓碑上没有。pub 是这次加密现生成的临时公钥（ECIES 的一半） */
  pub?: string
  iv?: string
  ct?: string
}

/** 一份保险库文件。本机那份与仓库里那份是同一个形状 —— 同步就是把它整份写过去 */
export interface VaultFile {
  version: number
  /** 这份文件是用哪把公钥加的密。换过密钥的设备一眼看得出来，而不是满屏解不开的条目 */
  key: VaultPublicKey
  /** 全部条目。**按 id 升序**：两台设备合并出同一份内容时才能逐字节一样，不产生假提交 */
  items: VaultItem[]
}

/**
 * 一条条目的正文（加密前 / 解密后就是这个）。字段都很短，密文里没有任何结构可认。
 */
export interface VaultEntry {
  /** 名字：卡片上那一行，也是认人的那一个。必填 */
  name: string
  password: string
  /** 备注：除了密码之外还想记一句的东西（两段式验证、备用码放在哪…） */
  notes: string
  /**
   * 分组：**自由文本，不是一份要管理的清单** —— 卡片按它归类，筛选标签从现存的取值里现算
   * （见 `vaultGroups`）。所以没有「新建分组 / 改名 / 删除」那一套。
   */
  group: string
}

/** 界面用的那条记录：解密出来的正文 + 信封里的元信息 */
export interface VaultRecord extends VaultEntry {
  id: string
  updatedAt: number
  by: string
}

/** 文件里认出来的那些 + 读不出来的条数（不为 0 时界面要如实说一句） */
export interface ParsedVault {
  file: VaultFile
  dropped: number
}

export function sanitizeVaultEntry(raw: unknown): VaultEntry {
  if (typeof raw !== 'object' || raw === null) return emptyVaultEntry()
  const value = raw as Record<string, unknown>
  const text = (key: string): string => (typeof value[key] === 'string' ? (value[key] as string) : '')

  return {
    // 名字这一栏原来叫 title：已经存下的记录读的时候认一下，别让它变成一张没有字的卡片
    name: (text('name') || text('title')).slice(0, 200),
    password: text('password').slice(0, 500),
    notes: text('notes').slice(0, 5000),
    // 分组名去掉首尾空白：`开发 ` 与 `开发` 必须被当成同一组 —— 否则排序认为它们不同、
    // 而筛选标签按名字精确匹配，点进去是空的（分组这一栏本来就是随手打的）
    group: text('group').trim().slice(0, 100)
  }
}

/** 新建一条空条目：名字空着，弹框里填 */
export function emptyVaultEntry(): VaultEntry {
  return { name: '', password: '', notes: '', group: '' }
}

/** 名字是唯一的必填项 —— 卡片上就靠它认人，没有名字的卡片是一块看不出是什么的东西 */
export function vaultEntryProblem(entry: VaultEntry): string | null {
  return entry.name.trim() ? null : '请填一个名字'
}

/** 删掉的条目留下的空壳：只记「什么时候、被哪台设备删的」，正文整段不要 */
export function tombstoneOf(item: Pick<VaultItem, 'id'>, updatedAt: number, by: string): VaultItem {
  return { id: item.id, updatedAt, by, deleted: true }
}

/** 用给定的条目凑出一份文件（本机那份与要推上去的那份都是它） */
export function vaultFileOf(key: VaultPublicKey, items: readonly VaultItem[]): VaultFile {
  return {
    version: VAULT_VERSION,
    key: publicKeyOf(key),
    items: mergeVaultItems(items, [])
  }
}

/** 空文件：还没建过保险库、或仓库里那份还不存在时用它当合并的一侧 */
export function emptyVaultFile(key: VaultPublicKey): VaultFile {
  return { version: VAULT_VERSION, key: publicKeyOf(key), items: [] }
}

/** 一条信封能不能用：缺 id / 时间不是数 / 正文三件套不齐的一律不算 */
function normalizeItem(raw: unknown): VaultItem | null {
  if (typeof raw !== 'object' || raw === null) return null
  const value = raw as Record<string, unknown>
  const id = typeof value.id === 'string' ? value.id.trim() : ''
  if (!id) return null
  if (typeof value.updatedAt !== 'number' || !Number.isFinite(value.updatedAt)) return null

  const by = typeof value.by === 'string' ? value.by : ''
  if (value.deleted === true) return { id, updatedAt: value.updatedAt, by, deleted: true }

  const pub = typeof value.pub === 'string' ? value.pub : ''
  const iv = typeof value.iv === 'string' ? value.iv : ''
  const ct = typeof value.ct === 'string' ? value.ct : ''
  if (!pub || !iv || !ct) return null

  return { id, updatedAt: value.updatedAt, by, pub, iv, ct }
}

/**
 * 读一份文件（本机存储里那份、或从仓库里拿回来的那份）。
 *
 * 认不出来返回 null —— 与「文件不存在」是两回事：仓库里那个路径上放着一份别的东西时，
 * 必须如实说「那不是保险库文件」，而不是当成空的然后拿本机这份把它盖掉。
 * 单条坏掉只丢那一条，并在 `dropped` 里报个数：整份作废等于把还能读的密码一起弄丢。
 */
export function parseVaultFile(raw: unknown): ParsedVault | null {
  if (typeof raw !== 'object' || raw === null) return null
  const value = raw as Record<string, unknown>
  if (typeof value.version !== 'number') return null
  if (!isVaultPublicKey(value.key)) return null
  if (!Array.isArray(value.items)) return null

  const items: VaultItem[] = []
  let dropped = 0
  for (const candidate of value.items) {
    const item = normalizeItem(candidate)
    if (item) items.push(item)
    else dropped += 1
  }

  return {
    file: {
      version: VAULT_VERSION,
      key: publicKeyOf(value.key),
      items: mergeVaultItems(items, [])
    },
    dropped
  }
}

// ---------- 查找与组织 ----------

/**
 * 卡片过滤：名字、备注、分组里任一处出现关键词即算命中（不分大小写）。
 *
 * 空关键词返回原列表 —— 顺带保证卡片顺序由调用方决定，这里不重排。
 */
export function filterVaultRecords(records: readonly VaultRecord[], query: string): VaultRecord[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return [...records]

  return records.filter((record) =>
    [record.name, record.notes, record.group].some((field) => field.toLowerCase().includes(needle))
  )
}

/** 按名字比：中文按拼音、数字按大小（`服务器 9` 排在 `服务器 10` 前面） */
function byName(a: VaultRecord, b: VaultRecord): number {
  return a.name.localeCompare(b.name, 'zh-Hans-CN', { numeric: true })
}

/**
 * 卡片的顺序：**先按分组、组内按名字**。
 *
 * 分组是自由文本，没有一份「分组顺序」可配，所以按名字排 —— 于是同一组的卡片在「全部」那一档里
 * 也是挨着的，一眼看得出归了哪些组。**未分组排在最后**：它是个兜底，不该挤在正经分组前面。
 * 末了拿 id 兜底，保证顺序是稳的（两台设备看到的排列一样）。
 */
export function sortVaultRecords(records: readonly VaultRecord[]): VaultRecord[] {
  return [...records].sort((a, b) => {
    if (!a.group !== !b.group) return a.group ? -1 : 1
    return (
      a.group.localeCompare(b.group, 'zh-Hans-CN', { numeric: true }) ||
      byName(a, b) ||
      (a.id < b.id ? -1 : 1)
    )
  })
}

/**
 * 现在有哪些分组：从卡片里现算，按名字排。
 *
 * 这里**不再各自去空白**：`group` 的不变量是「已经过 `sanitizeVaultEntry` 收敛」
 * （排序、筛选标签、分段三处都按同一个值比，各自处理一次反而会做出三个不同的判断）。
 */
export function vaultGroups(records: readonly VaultRecord[]): string[] {
  const names = new Set<string>()
  for (const record of records) {
    if (record.group) names.add(record.group)
  }
  return [...names].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN', { numeric: true }))
}

/** 没归类的那一段的标题。与筛选标签上的「未分组」是同一个词 */
export const UNGROUPED_LABEL = '未分组'

/** 卡片墙的一段：一个分组，加它下面的卡片 */
export interface VaultSection {
  /** 分组名；空串是「未分组」那一段 */
  key: string
  label: string
  records: VaultRecord[]
}

/**
 * 把卡片按分组切成一段一段。
 *
 * **输入必须已经按分组排好**（`sortVaultRecords` 的输出）：于是相邻的同组卡片自然连成一段，
 * 一个 Map 都不需要。分段与排序拆成两个函数是有意的 —— 排序管「谁先谁后」、分段管「哪儿断开」。
 */
export function groupVaultRecords(records: readonly VaultRecord[]): VaultSection[] {
  const sections: VaultSection[] = []

  for (const record of records) {
    const last = sections[sections.length - 1]
    if (last && last.key === record.group) last.records.push(record)
    else sections.push({ key: record.group, label: record.group || UNGROUPED_LABEL, records: [record] })
  }

  return sections
}

/** 最近改动的那一条的时间（毫秒），一条都没有时 0 —— 界面上的「更新于」用它 */
export function lastChangeAt(items: readonly VaultItem[]): number {
  return items.reduce((latest, item) => (item.updatedAt > latest ? item.updatedAt : latest), 0)
}