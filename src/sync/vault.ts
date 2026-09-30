/**
 * 保险库的编排层：本机那份文件、密钥生命周期、以及一轮同步的三步。
 *
 * 分工（与桌面端同一条口径，见 AGENTS.md）：
 *  - 本机那份 JSON 存 `localStorage` —— 壳里没有文件系统，也没有 git；
 *  - **加解密与合并全在这里调**，算式来自 `vault/`（纯函数）与 `sync/merge.ts`（纯函数）；
 *  - 网络那一层只认「取一段文本 / 放一段文本」（`sync/gitee.ts`），不认识保险库的形状。
 *
 * **同步为什么不是一步**：那份文件是所有设备共写的，而合并要拿「本机那份」与「远端那份」
 * 一起算。所以一轮同步是三步，且**可能要走两遍**：
 *
 *   pull（取回远端） → merge（合并，纯函数） → 落盘 / 加密 → push（写回远端）
 *
 * push 带上「读的时候那个 sha」，Gitee 会替我们挡住「别的设备在这一轮里推过」——
 * 被挡下就重新取一遍再合一次，最多三遍；三遍还撞上就如实报失败，让用户再点一次，
 * 而不是猜一个结果写下去。
 *
 * **同步受配置限制**：仓库地址与令牌由设置页给。保险库本身在没配同步时照常能用 ——
 * 本机那份是完整的，只是推不出去，界面会如实说明。
 */

import { fail, ok, reasonOf, type Result } from '@/result'
import type { VaultKeyState, VaultLoaded, VaultSyncOutcome } from '@/types'
import {
  createVaultKey,
  encodeKeyString,
  parseKeyString,
  publicKeyFingerprint,
  publicKeyOf,
  sameVaultKey,
  type VaultPrivateKey,
  type VaultPublicKey
} from '@/vault/key'
import { open, openAll, seal } from '@/vault/crypto'
import {
  emptyVaultFile,
  lastChangeAt,
  parseVaultFile,
  sanitizeVaultEntry,
  tombstoneOf,
  vaultFileOf,
  type ParsedVault,
  type VaultEntry,
  type VaultFile,
  type VaultItem,
  type VaultRecord
} from '@/vault/file'
import { mergeVaultItems } from '@/sync/merge'
import { pullFile, pushFile, type GiteeConfig } from '@/sync/gitee'
import {
  clearKeyString,
  deviceId,
  readKeyString,
  writeKeyString
} from '@/storage'

/** 一轮同步最多走几遍（每遍都是「远端又变了，重新合一次」）；走完还撞上就报失败 */
const SYNC_ROUNDS = 3

/** 本机那份文件在 localStorage 里的键 */
const FILE_STORAGE = 'vault.file'

/** 本机这把密钥在内存里。**只在本进程里活着** —— 落盘那份由 `storage.ts` 管 */
let cachedKey: VaultPrivateKey | null = null

// ---------- 本机那份文件 ----------

function readLocalRaw(): unknown {
  try {
    const raw = window.localStorage.getItem(FILE_STORAGE)
    return raw ? (JSON.parse(raw) as unknown) : null
  } catch {
    return null
  }
}

function writeLocalRaw(file: VaultFile): Result<null> {
  try {
    window.localStorage.setItem(FILE_STORAGE, JSON.stringify(file))
    return ok(null)
  } catch (error) {
    return fail(`保存保险库失败：${reasonOf(error)}`)
  }
}

/** 本机那份（原样返回，收敛交给 `parseVaultFile`） */
function loadFile(key: VaultPublicKey): Result<VaultFile> {
  const raw = readLocalRaw()
  // 还没有文件（第一次用）时是 null，那不是错误
  if (raw === null || raw === undefined) return ok(emptyVaultFile(key))

  const parsed = parseVaultFile(raw)
  if (!parsed) return fail('本机那份 vault 数据认不出来（可能被改坏了）')
  return ok(parsed.file)
}

function saveFile(file: VaultFile): Result<null> {
  return writeLocalRaw(file)
}

// ---------- 密钥 ----------

/** 当前密钥状态（界面据此显示「还没建库 / 已解锁 / 锁着」） */
export async function keyState(): Promise<Result<VaultKeyState>> {
  if (cachedKey) {
    return ok({ exists: true, unlocked: true, fingerprint: await publicKeyFingerprint(cachedKey) })
  }

  const stored = readKeyString()
  const key = stored ? parseKeyString(stored) : null
  return ok({
    exists: Boolean(key),
    unlocked: false,
    /*
     * 指纹**没解锁也算得出来**：它就是公钥的摘要（公开信息），而锁着那一屏上要显示的正是它 ——
     * 让用户核对两台设备拿的是不是同一把，而那时界面恰恰是锁着的。
     */
    fingerprint: key ? await publicKeyFingerprint(key) : ''
  })
}

/**
 * 解锁：把密钥从本机存储取进内存。
 *
 * **不做口令校验这一层**：密钥就存在这台设备上，能打开这个 App 就说明已经能用这台设备了 ——
 * 再加一道口令是在本地多存一份可以忘掉的东西，而它并不能挡住已经拿到设备的人。
 */
export async function unlock(): Promise<Result<VaultKeyState>> {
  const stored = readKeyString()
  const key = stored ? parseKeyString(stored) : null
  if (!key) return fail('这台设备上还没有保险库密钥，先创建或导入一把')

  cachedKey = key
  return ok({ exists: true, unlocked: true, fingerprint: await publicKeyFingerprint(key) })
}

/** 锁上：把内存里那把丢掉。**不动本机存储**，下次解锁照样能进来 */
export function lock(): Result<VaultKeyState> {
  cachedKey = null
  return ok({ exists: true, unlocked: false, fingerprint: '' })
}

/** 手上这把密钥（没解锁时是 null）。合并与落盘都要它 */
export function currentKey(): VaultPrivateKey | null {
  return cachedKey
}

/**
 * 换密钥（新建 / 导入）之后把本机那份挪到新密钥下。
 *
 * 两条，缺一不可：
 *  - **能读出来的条目解开再用新密钥封回去** —— 换密钥不该顺手把密码弄丢；
 *  - **读不出来的留墓碑** —— 那些条目在任何设备上都解不开了，不清掉的话下一次同步
 *    会把它们当成本机内容并进去（合并只认 id 与时间，看不见密文），界面上就是一堆
 *    永远解不开、也删不掉的条目。
 */
async function adoptKey(next: VaultPrivateKey, previous: VaultPrivateKey | null): Promise<Result<null>> {
  const file = loadFile(next)
  if (!file.ok) return fail(file.error)

  const device = deviceId()
  const updatedAt = Date.now()
  const kept: VaultItem[] = []

  if (previous) {
    for (const item of file.data.items) {
      if (item.deleted) continue
      try {
        const entry = await open(previous, item)
        kept.push({ id: item.id, updatedAt, by: device, ...(await seal(publicKeyOf(next), entry)) })
      } catch {
        // 旧密钥也解不开这一条：它本来就没救了，下面按墓碑处理
      }
    }
  }

  const readable = new Set(kept.map((item) => item.id))
  const tombstones = file.data.items
    .filter((item) => !readable.has(item.id))
    .map((item) => tombstoneOf(item, updatedAt, device))

  return saveFile(vaultFileOf(next, [...tombstones, ...kept]))
}

/**
 * 建一把新密钥并存起来，同时把本机那份挪到新密钥下。
 * `replace` 为假时**已有密钥就不动**（避免把现有条目全废掉）。
 */
export async function createKey(replace: boolean): Promise<Result<VaultKeyState>> {
  const stored = readKeyString()
  if (stored && !replace) return fail('这台设备上已经有一把密钥了')

  const previous = currentKey()
  const key = await createVaultKey()
  writeKeyString(encodeKeyString(key))

  cachedKey = key
  const adopted = await adoptKey(key, previous)
  if (!adopted.ok) return fail(adopted.error)

  return ok({ exists: true, unlocked: true, fingerprint: await publicKeyFingerprint(key) })
}

/**
 * 导入一把别处导出的密钥，并把本机那份挪到它下面。
 *
 * 正常用法是在**新设备**上导入：本机还没有文件，导入完同步一次就把仓库里那些条目拉下来了。
 * 在一台已经有保险库的设备上导入另一把密钥，等于换成另一份保险库 —— 本机原来那些条目
 * （用旧密钥加的密）按墓碑处理，见 `adoptKey`。
 */
export async function importKey(text: string): Promise<Result<VaultKeyState>> {
  const key = parseKeyString(text)
  if (!key) return fail('这段内容不是一把保险库密钥')

  const previous = currentKey()
  writeKeyString(encodeKeyString(key))

  cachedKey = key
  const adopted = await adoptKey(key, previous)
  if (!adopted.ok) return fail(adopted.error)

  return ok({ exists: true, unlocked: true, fingerprint: await publicKeyFingerprint(key) })
}

/** 忘掉本机密钥（换密钥、或要把这台设备彻底退出保险库时用） */
export function forgetKey(): Result<VaultKeyState> {
  clearKeyString()
  cachedKey = null
  return ok({ exists: false, unlocked: false, fingerprint: '' })
}

/** 导出用的密钥串（导出成一段可复制的文本；没解锁时给 null） */
export function exportKeyString(): string | null {
  return cachedKey ? encodeKeyString(cachedKey) : null
}

// ---------- 条目 ----------

/** 读出全部条目。**解密在这里**：密钥在内存里拿到，明文也只活在内存里 */
export async function load(): Promise<Result<VaultLoaded>> {
  const key = currentKey()
  if (!key) return fail('保险库还没有解锁')

  const raw = readLocalRaw()
  const parsed =
    raw === null || raw === undefined ? { file: emptyVaultFile(publicKeyOf(key)), dropped: 0 } : parseVaultFile(raw)
  if (!parsed) return fail('本机那份 vault 数据认不出来（可能被改坏了）')

  const { records, failed } = await openAll(key, parsed.file)
  return ok({
    records,
    unreadable: failed.length,
    dropped: parsed.dropped,
    updatedAt: lastChangeAt(parsed.file.items)
  })
}

/** 一条条目的元信息（更新与删除都要用 id） */
export interface VaultWriteInput {
  id: string
  entry: VaultEntry
}

/**
 * 写一条（新增或改动）。
 *
 * **只重封这一条**：其余条目的密文原样留着 —— 重新加密一遍会让字节也全变，
 * 于是「内容没变就不产生提交」这条约定失效，仓库里会堆出一串无意义的提交。
 */
export async function save(input: VaultWriteInput): Promise<Result<VaultRecord>> {
  const key = currentKey()
  if (!key) return fail('保险库还没有解锁')

  const file = loadFile(key)
  if (!file.ok) return fail(file.error)

  const device = deviceId()
  const updatedAt = Date.now()
  // **收敛之后再封**，回来的那条也用收敛后的值：`seal` 自己也会过一遍 sanitize，
  // 于是不收敛的话，界面上拿到的（`开发 `）与存下的（`开发`）会差一个空白 ——
  // 刷新一次分组标签就换了个写法
  const entry = sanitizeVaultEntry(input.entry)
  const sealed = await seal(publicKeyOf(key), entry)
  const item: VaultItem = { id: input.id, updatedAt, by: device, ...sealed }

  const items = [...file.data.items.filter((existing) => existing.id !== input.id), item]
  const written = saveFile(vaultFileOf(key, items))
  if (!written.ok) return fail(written.error)

  return ok({ ...entry, id: input.id, updatedAt, by: device })
}

/** 删一条：换成墓碑。空壳留着是为了让别的设备别把它复活（见 `mergeVaultItems`） */
export function remove(id: string): Result<null> {
  const key = currentKey()
  if (!key) return fail('保险库还没有解锁')

  const file = loadFile(key)
  if (!file.ok) return fail(file.error)

  const items = [
    ...file.data.items.filter((existing) => existing.id !== id),
    tombstoneOf({ id }, Date.now(), deviceId())
  ]
  return saveFile(vaultFileOf(key, items))
}

// ---------- 同步 ----------

/**
 * 解析从仓库里取回的那段文本。
 *
 * `JSON.parse` 也会抛（仓库里那份被人手工改成了别的文本），所以两步都收在一个函数里 ——
 * 认不出来一律 null，交给调用方说一句「那不是一份保险库文件」，而不是把异常漏到界面上。
 */
function parseRemoteContent(content: string): ParsedVault | null {
  try {
    return parseVaultFile(JSON.parse(content))
  } catch {
    return null
  }
}

/** 一轮同步：取回远端 → 与本机那份合并 → 落盘 → 写回去 */
export async function sync(config: GiteeConfig): Promise<Result<VaultSyncOutcome>> {
  const key = currentKey()
  if (!key) return fail('保险库还没有解锁')
  if (!config.token.trim()) return fail('还没有填 Gitee 令牌')
  if (!config.owner.trim() || !config.repo.trim()) return fail('还没有填同步仓库')

  const local = loadFile(key)
  if (!local.ok) return fail(local.error)

  let merged = local.data
  let remoteItems = 0
  let remoteKeyMismatch = false

  for (let round = 0; round < SYNC_ROUNDS; round += 1) {
    const remote = await pullFile(config)
    if (!remote.ok) return fail(remote.error.message)

    const pulled = remote.data
    const parsedRemote = pulled ? parseRemoteContent(pulled.content) : null
    if (pulled && !parsedRemote) return fail('仓库里那个路径上放的不是一份保险库文件')

    const remoteFile = parsedRemote?.file ?? null
    remoteItems = remoteFile?.items.length ?? 0

    // 仓库里那份是用别的密钥加的密：能合并、能推，但那些条目在这台设备上永远解不开。
    // 这不能悄悄过去 —— 用户会看到「同步成功，但一条都没多出来」。
    if (remoteFile && !sameVaultKey(remoteFile, key)) remoteKeyMismatch = true

    merged = vaultFileOf(key, mergeVaultItems(merged.items, remoteFile?.items ?? []))

    const saved = saveFile(merged)
    if (!saved.ok) return fail(saved.error)

    const pushed = await pushFile(config, JSON.stringify(merged, null, 2), pulled?.sha ?? null)
    if (pushed.ok) {
      const loaded = await load()
      if (!loaded.ok) return fail(loaded.error)
      return ok({
        rounds: round + 1,
        remoteItems,
        keyMismatch: remoteKeyMismatch,
        ...loaded.data
      })
    }

    // 远端在这一轮里又被推过：下一轮重新取一遍再合一次。其余失败如实报出去
    if (pushed.error.kind !== 'conflict') return fail(pushed.error.message)
  }

  return fail('同步撞了三轮都没落定（仓库里那份一直在被改动），稍后再试一次')
}

/** 仓库里那份与本机这把密钥对不对得上（给界面提前说一句「两边密钥不一样」） */
export async function remoteKeyStatus(config: GiteeConfig): Promise<Result<'none' | 'match' | 'mismatch'>> {
  const key = currentKey()
  if (!key) return fail('保险库还没有解锁')

  const remote = await pullFile(config)
  if (!remote.ok) return fail(remote.error.message)
  if (!remote.data) return ok('none')

  const parsed = parseRemoteContent(remote.data.content)
  if (!parsed) return fail('仓库里那个路径上放的不是一份保险库文件')

  return ok(sameVaultKey(parsed.file, key) ? 'match' : 'mismatch')
}