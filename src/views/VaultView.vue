/**
 * 主页面：四种样子 + 一面卡片墙。
 *
 * **为什么是一个状态机而不是四张页面**：这四种样子是同一件事的四个阶段（还没查密钥 /
 * 还没建库 / 锁着 / 已解锁），切页面会丢掉「刚才搜的是什么」「刚才亮的是哪一张」这些状态，
 * 而切状态不会。判据全部来自 store，这一层只负责画。
 *
 * 几处刻意的取舍：
 *  - **密码默认遮住**，眼睛是逐张切换的；设置里可以关掉遮罩（那时一进来就是明文）；
 *  - 改与删收进卡片上的「⋯」，因为那是偶尔才做一次的事 —— 而复制与查看是常用的两颗；
 *  - 添加做成右下角的圆形按钮（不用顶栏里再塞一颗）：大拇指够得到，也是移动端的惯例。
 */

<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import AppSheet from '@/components/ui/AppSheet.vue'
import VaultCard from '@/components/VaultCard.vue'
import VaultEntryDialog from '@/components/VaultEntryDialog.vue'
import VaultKeyDialog from '@/components/VaultKeyDialog.vue'
import SettingsPanel from '@/components/SettingsPanel.vue'
import { copyText } from '@/clipboard'
import { notifyFailure, notifyInfo, notifySuccess } from '@/toast'
import { useSettingsStore } from '@/stores/settings'
import { useVaultStore } from '@/stores/vault'
import type { VaultEntry, VaultRecord } from '@/vault/file'

const store = useVaultStore()
const settingsStore = useSettingsStore()
const activeTab = ref<'vault' | 'me'>('vault')

/** 遮罩串。**固定长度**，不按真实长度铺点：长度也是信息，没必要替用户说出去 */
const MASK = '••••••••'

// ---------- 逐张显示 ----------

/** 用户手动点过的那一张。null 表示还没点过 —— 那时各张按设置里的默认来 */
const toggledId = ref<string | null>(null)
const toggledRevealed = ref(false)

function isRevealed(id: string): boolean {
  if (toggledId.value === id) return toggledRevealed.value
  return false
}

function toggleReveal(id: string): void {
  const now = isRevealed(id)
  toggledId.value = id
  toggledRevealed.value = !now
}

// ---------- 复制 ----------

async function copyPassword(record: VaultRecord): Promise<void> {
  if (!record.password) {
    notifyInfo('这条没有记密码')
    return
  }
  const done = await copyText(record.password)
  if (done) notifySuccess(`已复制「${record.name}」的密码`)
  else notifyFailure('复制', '这台设备不让读剪贴板，请点开眼睛手动选中')
}

// ---------- 编辑弹层 ----------

const entryOpen = ref(false)
/** 正在编辑的那条；null 表示新增 */
const entryRecord = ref<VaultRecord | null>(null)
/** 保存中：弹层据此不关、按钮变灰 */
const savingEntry = ref(false)

function openEntry(record: VaultRecord | null): void {
  entryRecord.value = record
  entryOpen.value = true
}

/**
 * 新条目的 id。**与设备、时间都无关**，只要两台设备生成的不会撞上就行 ——
 * 合并时它就是这一条的身份（见 file.ts 的 `VaultItem.id`）。
 */
function newEntryId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function submitEntry(entry: VaultEntry): Promise<void> {
  const target = entryRecord.value
  savingEntry.value = true
  try {
    const done = await store.saveEntry(target?.id ?? newEntryId(), entry)
    // 失败时**不关**：填过的字一个都不能丢，让用户在原处改
    if (done) entryOpen.value = false
  } finally {
    savingEntry.value = false
  }
}

// ---------- 那一张卡片上的「⋯」 ----------

const menuOpen = ref(false)
const menuRecord = ref<VaultRecord | null>(null)
const confirmDelete = ref(false)

function openMenu(record: VaultRecord): void {
  menuRecord.value = record
  confirmDelete.value = false
  menuOpen.value = true
}

function editFromMenu(): void {
  const record = menuRecord.value
  menuOpen.value = false
  // 等这一层收完再开编辑层：两层抽屉同时在场会叠在一起
  void nextTick(() => openEntry(record))
}

async function deleteFromMenu(): Promise<void> {
  const record = menuRecord.value
  if (!record) return
  menuOpen.value = false
  await store.removeEntry(record.id)
}

// ---------- 密钥与会话 ----------

const keyOpen = ref(false)
/** 导出用的密钥串。**没解锁时给 null** —— 私钥在内存里，锁上了就取不出来 */
const keyString = computed(() => (keyOpen.value ? store.exportKeyString() : null))

function lock(): void {
  store.lock()
  // 收起密码就是「屏幕上与内存里都没有」：连「哪一张亮着」这个信息也一起丢掉
  toggledId.value = null
  toggledRevealed.value = false
}

// ---------- 设置 ----------

const settingsOpen = ref(false)

// ---------- 顶栏那一行说明 ----------

const subtitle = computed(() => {
  if (!store.unlocked) return '加解密都在这台设备上'
  const stored = store.updatedAt ? new Date(store.updatedAt) : null
  if (!stored) return store.summary
  const pad = (value: number): string => String(value).padStart(2, '0')
  const when = `${stored.getMonth() + 1}月${stored.getDate()}日 ${pad(stored.getHours())}:${pad(stored.getMinutes())}`
  return `${store.summary} · 更新于 ${when}`
})

const hasRecords = computed(() => store.records.length > 0)
</script>

<template>
  <div class="view">
    <!-- ---------- 顶栏 ---------- -->
    <header class="topbar">
      <div class="topbar__row">
        <div class="topbar__id">
          <h1 class="topbar__title">{{ activeTab === 'vault' ? '密码' : '我的' }}</h1>
          <p class="topbar__meta">{{ activeTab === 'vault' ? subtitle : '设备、密钥与应用设置' }}</p>
        </div>

        <div v-if="activeTab === 'vault' && store.unlocked" class="topbar__ops">
          <button
            type="button"
            class="icon-btn"
            :disabled="store.syncing"
            :aria-label="store.syncing ? '正在同步' : '同步'"
            @click="store.sync()"
          >
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" :class="{ spin: store.syncing }">
              <path
                d="M20 12a8 8 0 1 1-2.3-5.6M20 4v4h-4"
                fill="none"
                stroke="currentColor"
                stroke-width="1.7"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </button>

          <button type="button" class="icon-btn" aria-label="保险库密钥" @click="keyOpen = true">
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <circle cx="8" cy="15" r="4" fill="none" stroke="currentColor" stroke-width="1.7" />
              <path d="m11 12 8-8m-2 2 3 3m-6-1 3 3" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </button>

          <button type="button" class="icon-btn" aria-label="锁上保险库" @click="lock">
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <rect x="4.5" y="10.5" width="15" height="9.5" rx="2.4" fill="none" stroke="currentColor" stroke-width="1.7" />
              <path d="M8 10.5V7.8a4 4 0 0 1 8 0v2.7" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" />
            </svg>
          </button>
        </div>
      </div>

      <label v-if="activeTab === 'vault' && store.unlocked && hasRecords" class="search">
        <svg class="search__icon" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
          <circle cx="11" cy="11" r="6" fill="none" stroke="currentColor" stroke-width="1.7" />
          <path d="M15.6 15.6L20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" />
        </svg>
        <input v-model="store.query" class="search__input" type="search" placeholder="搜名字、备注、分组" />
        <button
          v-if="store.query"
          type="button"
          class="search__clear"
          aria-label="清空搜索"
          @click="store.query = ''"
        >
          ×
        </button>
      </label>

      <p v-if="store.unlocked && store.syncNote" class="note" :class="{ 'is-failed': store.syncFailed }">
        {{ store.syncNote }}
      </p>
    </header>

    <!-- ---------- 正文 ---------- -->
    <main class="body">
      <template v-if="activeTab === 'me'">
        <section class="me-hero">
          <div class="me-hero__avatar">我</div>
          <div>
            <h2 class="me-hero__title">我的空间</h2>
            <p class="me-hero__text">管理这台设备上的密钥、同步和外观。</p>
          </div>
        </section>
        <section class="me-list">
          <button type="button" class="me-item" @click="settingsOpen = true">
            <span class="me-item__icon">⚙</span>
            <span class="me-item__main"><strong>系统设置</strong><small>同步、主题、状态栏与关于</small></span>
            <span class="me-item__arrow">›</span>
          </button>
        </section>
      </template>

      <template v-else>
      <!-- 还没问过密钥状态：**不要先画「创建保险库」再跳成别的样子**，那会闪一下 -->
      <p v-if="!store.keyChecked" class="hint">正在读取本机密钥…</p>

      <!-- 这台设备上还没有密钥 -->
      <section v-else-if="!store.keyExists" class="intro">
        <div class="intro__mark" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="30" height="30">
            <rect x="4.5" y="10.5" width="15" height="9.5" rx="2.4" fill="none" stroke="currentColor" stroke-width="1.6" />
            <path d="M8 10.5V7.8a4 4 0 0 1 8 0v2.7" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
          </svg>
        </div>
        <h2 class="intro__title">还没有保险库</h2>
        <p class="intro__text">
          先在这台设备上生成一把密钥。它会加密你记下的每一条密码，也只有拿着它才解得开 ——
          所以之后要把它导出到别的设备上（比如桌面端 Workbench），两边才看得见同一份记录。
        </p>
        <div class="intro__ops">
          <button type="button" class="btn btn--primary btn--block" :disabled="store.creating" @click="store.createKey()">
            {{ store.creating ? '正在生成…' : '创建保险库' }}
          </button>
          <button type="button" class="btn btn--block" @click="keyOpen = true">已经有密钥，导入</button>
        </div>
      </section>

      <!-- 锁着 -->
      <section v-else-if="!store.unlocked" class="intro">
        <div class="intro__mark" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="30" height="30">
            <rect x="4.5" y="10.5" width="15" height="9.5" rx="2.4" fill="none" stroke="currentColor" stroke-width="1.6" />
            <path d="M8 10.5V7.8a4 4 0 0 1 8 0v2.7" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
          </svg>
        </div>
        <h2 class="intro__title">保险库锁着</h2>
        <p class="intro__text">
          密钥就在这台设备上，解锁只是把它取进内存 —— 明文只在这里活着，锁上就没了。
        </p>
        <p class="intro__finger">
          公钥指纹 <span class="mono">{{ store.fingerprint || '—' }}</span>
        </p>
        <div class="intro__ops">
          <button type="button" class="btn btn--primary btn--block" @click="store.unlock()">解锁</button>
          <button type="button" class="btn btn--block" @click="keyOpen = true">导入别的密钥</button>
        </div>
      </section>

      <!-- 已解锁 -->
      <template v-else>
        <!-- 三句如实说明。有才出现，没有就不占地方 -->
        <p v-if="store.unreadable" class="alert">
          {{ store.unreadable }} 条记录是用别的密钥加密的，在这台设备上解不开 ——
          说明两台设备拿到的不是同一把密钥。
        </p>
        <p v-if="store.dropped" class="alert">{{ store.dropped }} 条记录的数据坏了（信封认不出来），已经跳过。</p>
        <p v-if="store.keyMismatch" class="alert">
          同步回来的那一份是用别的密钥加的密，那些记录在这台设备上看不到。
        </p>

        <!-- 一条都没有 -->
        <section v-if="!hasRecords" class="intro">
          <h2 class="intro__title">还没有记录</h2>
          <p class="intro__text">点右下角那颗加号，记下第一条密码。名字是必填的，其余想记就记。</p>
        </section>

        <!-- 搜不到 -->
        <p v-else-if="!store.visibleRecords.length" class="hint">
          没有匹配「{{ store.query }}」的记录。
        </p>

        <template v-else>
          <section v-for="section in store.sections" :key="section.key || '__ungrouped__'" class="group">
            <h2 class="group__title">
              {{ section.label }}
              <span class="group__count">{{ section.records.length }}</span>
            </h2>
            <div class="grid">
              <VaultCard
                v-for="record in section.records"
                :key="record.id"
                :record="record"
                :revealed="isRevealed(record.id)"
                :mask="MASK"
                @toggle-reveal="toggleReveal(record.id)"
                @copy-password="copyPassword(record)"
                @menu="openMenu(record)"
              />
            </div>
          </section>
        </template>
      </template>
      </template>
    </main>

    <nav class="tabbar" aria-label="主导航">
      <button type="button" class="tabbar__item" :class="{ 'is-active': activeTab === 'vault' }" @click="activeTab = 'vault'">
        <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="8" width="16" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M8 8V6.5a4 4 0 0 1 8 0V8" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>
        <span>密码</span>
      </button>
      <button type="button" class="tabbar__item" :class="{ 'is-active': activeTab === 'me' }" @click="activeTab = 'me'">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="3.3" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M5.5 20a6.5 6.5 0 0 1 13 0" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>
        <span>我的</span>
      </button>
    </nav>

    <!-- ---------- 添加 ---------- -->
    <button v-if="activeTab === 'vault' && store.unlocked" type="button" class="fab" aria-label="添加记录" @click="openEntry(null)">
      <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
        <path d="M12 5.5v13M5.5 12h13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
      </svg>
    </button>

    <!-- ---------- 卡片上的「⋯」 ---------- -->
    <AppSheet
      v-model:visible="menuOpen"
      :title="menuRecord?.name || ''"
      :description="menuRecord?.group ? `分组：${menuRecord.group}` : '未分组'"
    >
      <div class="menu">
        <button type="button" class="menu__item" @click="editFromMenu">
          <span>编辑</span>
          <span class="menu__hint">改名字、密码、分组、备注</span>
        </button>
        <button type="button" class="menu__item menu__item--danger" @click="confirmDelete = true">
          <span>删除</span>
          <span class="menu__hint">同步之后别的设备上也会不见</span>
        </button>
      </div>

      <p v-if="confirmDelete" class="menu__warn">
        删除会在文件里留下一块墓碑（不是真删掉那一行）—— 这是为了让别的设备别把它再同步回来。
      </p>

      <template #footer>
        <template v-if="confirmDelete">
          <button type="button" class="btn" @click="confirmDelete = false">再想想</button>
          <button type="button" class="btn btn--danger" @click="deleteFromMenu">确认删除</button>
        </template>
        <button v-else type="button" class="btn btn--block" @click="menuOpen = false">关闭</button>
      </template>
    </AppSheet>

    <!-- ---------- 添加 / 编辑 ---------- -->
    <VaultEntryDialog
      v-model:visible="entryOpen"
      :record="entryRecord"
      :groups="store.groups"
      :saving="savingEntry"
      @save="submitEntry"
    />

    <!-- ---------- 密钥 ---------- -->
    <VaultKeyDialog
      v-model:visible="keyOpen"
      :key-exists="store.keyExists"
      :unlocked="store.unlocked"
      :fingerprint="store.fingerprint"
      :busy="store.creating"
      :key-string="keyString"
      @create="store.createKey($event)"
      @import="store.importKeyText($event)"
      @forget="store.forgetKey()"
    />

    <!-- ---------- 系统设置 ---------- -->
    <AppSheet v-model:visible="settingsOpen" title="系统设置" tall>
      <SettingsPanel
        :settings="settingsStore.settings"
        :sync-note="store.syncNote"
        :sync-failed="store.syncFailed"
        @change="settingsStore.save($event)"
      />
    </AppSheet>
  </div>
</template>

<style scoped>
.view {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  min-height: 100%;
}

/* ---------- 顶栏 ---------- */

/*
 * 顶栏是**玻璃的一层**而不是一条实心色带：滚动时底下的卡片从它下面透过去，
 * 「这块浮在内容上面」才成立。`sticky` 而不是 `fixed`，是为了让它自然地占住文档流高度。
 */
.topbar {
  position: sticky;
  top: 0;
  z-index: 20;
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
  padding: calc(var(--safe-top) + var(--sp-4)) max(var(--sp-4), var(--safe-side)) var(--sp-3);
  border-bottom: 1px solid var(--glass-edge);
  background: var(--glass-strong);
  backdrop-filter: blur(var(--blur)) saturate(180%);
  -webkit-backdrop-filter: blur(var(--blur)) saturate(180%);
}

.topbar__row {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
}

.topbar__id {
  flex: 1 1 auto;
  min-width: 0;
}

.topbar__title {
  margin: 0;
  color: var(--ink);
  font-size: var(--fs-head);
  font-weight: 650;
  letter-spacing: -0.01em;
}

.topbar__meta {
  margin: 2px 0 0;
  color: var(--ink-3);
  font-size: var(--fs-micro);
}

.topbar__ops {
  display: flex;
  flex-shrink: 0;
  gap: var(--sp-2);
}

.spin {
  animation: spin 0.9s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

/* ---------- 搜索 ---------- */

.search {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  height: 40px;
  padding: 0 var(--sp-3);
  border-radius: var(--r-md);
  background: var(--glass-soft);
  box-shadow: 0 0 0 1px var(--line) inset;
  color: var(--ink-3);
}

.search:focus-within {
  box-shadow: 0 0 0 1.5px var(--accent) inset;
}

.search__icon {
  flex-shrink: 0;
}

.search__input {
  flex: 1 1 auto;
  min-width: 0;
  border: 0;
  background: transparent;
  color: var(--ink);
  font-family: inherit;
  font-size: var(--fs-body);
  outline: none;
  /* 类型是 search 时浏览器会给一个自带的清除按钮，与下面那颗重复 */
  appearance: none;
}

.search__input::-webkit-search-cancel-button {
  display: none;
}

.search__clear {
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: var(--line-strong);
  color: var(--ink);
  font-size: 15px;
  line-height: 1;
  cursor: pointer;
}

/* 同步结果那一句：成功也灰着（不用抢注意力），失败才变红 */
.note {
  margin: 0;
  color: var(--ink-3);
  font-size: var(--fs-micro);
}

.note.is-failed {
  color: var(--danger);
}

/* ---------- 正文 ---------- */

.body {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: var(--sp-5);
  padding: var(--sp-5) max(var(--sp-4), var(--safe-side)) calc(var(--sp-6) + 76px + var(--safe-bottom));
}

/* ---------- 底部导航 ---------- */

.tabbar {
  position: fixed;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 25;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  min-height: 64px;
  padding: var(--sp-2) max(var(--sp-3), var(--safe-side)) calc(var(--sp-2) + var(--safe-bottom));
  border-top: 1px solid var(--glass-edge);
  background: var(--glass-strong);
  backdrop-filter: blur(var(--blur)) saturate(180%);
  -webkit-backdrop-filter: blur(var(--blur)) saturate(180%);
}

.tabbar__item {
  display: flex;
  min-width: 0;
  min-height: 48px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  padding: 0 var(--sp-2);
  border: 0;
  background: transparent;
  color: var(--ink-3);
  font-family: inherit;
  font-size: var(--fs-micro);
  cursor: pointer;
}

.tabbar__item svg {
  width: 22px;
  height: 22px;
  flex-shrink: 0;
}

.tabbar__item span {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tabbar__item.is-active {
  color: var(--accent);
}

/* 导航占据底部安全区，FAB 始终停在导航上方。 */
.view .fab {
  bottom: calc(76px + var(--safe-bottom));
}

@media (min-width: 560px) {
  .tabbar {
    left: 50%;
    width: min(480px, 100%);
    transform: translateX(-50%);
    border-right: 1px solid var(--glass-edge);
    border-left: 1px solid var(--glass-edge);
  }
}

.group {
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
}

.group__title {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  margin: 0;
  color: var(--ink-2);
  font-size: var(--fs-meta);
  font-weight: 600;
}

.group__count {
  padding: 1px 7px;
  border-radius: 999px;
  background: var(--glass-soft);
  box-shadow: 0 0 0 1px var(--line) inset;
  color: var(--ink-3);
  font-size: var(--fs-micro);
  font-weight: 500;
}

.grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: var(--sp-3);
}

/* 宽一点的屏（平板 / 横屏）排两列：一列拉得太宽时卡片会摊得很难看 */
@media (min-width: 560px) {
  .grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

/* ---------- 引导与提示 ---------- */

.intro {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--sp-3);
  padding: var(--sp-6) var(--sp-4);
  border: 1px solid var(--glass-edge);
  border-radius: var(--r-xl);
  background: var(--glass);
  backdrop-filter: blur(var(--blur)) saturate(180%);
  -webkit-backdrop-filter: blur(var(--blur)) saturate(180%);
  text-align: center;
}

.intro__mark {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 60px;
  height: 60px;
  margin-bottom: var(--sp-1);
  border-radius: 50%;
  background: var(--accent-soft);
  color: var(--accent);
}

.intro__title {
  margin: 0;
  color: var(--ink);
  font-size: var(--fs-title);
  font-weight: 600;
}

.intro__text {
  max-width: 34em;
  margin: 0;
  color: var(--ink-3);
  font-size: var(--fs-meta);
  line-height: 1.75;
}

.intro__finger {
  margin: 0;
  color: var(--ink-3);
  font-size: var(--fs-micro);
}

.intro__finger .mono {
  color: var(--ink-2);
  font-size: var(--fs-meta);
}

.intro__ops {
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
  width: 100%;
  max-width: 320px;
  margin-top: var(--sp-2);
}

.hint {
  margin: 0;
  padding: var(--sp-6) 0;
  color: var(--ink-3);
  font-size: var(--fs-meta);
  text-align: center;
}

/* 如实说明那几句：**用警示色而不是危险色** —— 它们是「请留意」，不是「出错了」 */
.alert {
  margin: 0;
  padding: var(--sp-3) var(--sp-4);
  border-radius: var(--r-md);
  background: var(--warn-soft);
  color: var(--warn);
  font-size: var(--fs-meta);
  line-height: 1.7;
}

/* ---------- 添加按钮 ---------- */

.fab {
  position: fixed;
  right: max(var(--sp-5), var(--safe-side));
  bottom: calc(var(--sp-5) + var(--safe-bottom));
  z-index: 30;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 56px;
  height: 56px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: linear-gradient(165deg, color-mix(in srgb, var(--accent) 92%, #fff), var(--accent));
  color: var(--accent-ink);
  box-shadow: 0 14px 30px -10px var(--accent), var(--shadow);
  cursor: pointer;
  transition: transform 0.14s ease;
}

.fab:active {
  transform: scale(0.93);
}

/* ---------- 「⋯」里那张清单 ---------- */

.menu {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}

.menu__item {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  padding: var(--sp-3) var(--sp-4);
  border: 0;
  border-radius: var(--r-md);
  background: var(--glass-soft);
  color: var(--ink);
  font-family: inherit;
  font-size: var(--fs-body);
  text-align: left;
  cursor: pointer;
}

.menu__item--danger {
  color: var(--danger);
  background: var(--danger-soft);
}

.menu__hint {
  color: var(--ink-3);
  font-size: var(--fs-micro);
}

.menu__item--danger .menu__hint {
  color: var(--danger);
  opacity: 0.75;
}

.menu__warn {
  margin: var(--sp-3) 0 0;
  color: var(--warn);
  font-size: var(--fs-micro);
  line-height: 1.7;
}

/* ---------- 设置里那一行「保险库密钥」 ---------- */

.entry {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  width: 100%;
  margin-bottom: var(--sp-5);
  padding: var(--sp-3) var(--sp-4);
  border: 1px solid var(--glass-edge);
  border-radius: var(--r-md);
  background: var(--glass-soft);
  color: var(--ink);
  font-family: inherit;
  font-size: var(--fs-body);
  cursor: pointer;
}

.entry__name {
  flex: 1 1 auto;
  text-align: left;
}

.entry__value {
  color: var(--ink-3);
  font-size: var(--fs-meta);
}

.entry__arrow {
  flex-shrink: 0;
  color: var(--ink-3);
}

.me-hero {
  display: flex;
  align-items: center;
  gap: var(--sp-4);
  padding: var(--sp-5);
  border: 1px solid var(--glass-edge);
  border-radius: var(--r-lg);
  background: var(--glass);
  box-shadow: var(--shadow-sm);
}

.me-hero__avatar {
  display: grid;
  width: 48px;
  height: 48px;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 16px;
  background: var(--accent-soft);
  color: var(--accent);
  font-size: var(--fs-title);
  font-weight: 700;
}

.me-hero__title,
.me-hero__text {
  margin: 0;
}

.me-hero__title {
  color: var(--ink);
  font-size: var(--fs-title);
}

.me-hero__text {
  margin-top: 3px;
  color: var(--ink-3);
  font-size: var(--fs-meta);
}

.me-list {
  display: flex;
  flex-direction: column;
  gap: 1px;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: var(--r-lg);
  background: var(--line);
}

.me-item {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  min-height: 68px;
  padding: var(--sp-3) var(--sp-4);
  border: 0;
  background: var(--glass);
  color: var(--ink);
  font-family: inherit;
  text-align: left;
  cursor: pointer;
}

.me-item:active {
  background: var(--glass-strong);
}

.me-item__icon {
  display: grid;
  width: 34px;
  height: 34px;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 11px;
  background: var(--accent-soft);
  color: var(--accent);
  font-size: 18px;
}

.me-item__main {
  display: flex;
  min-width: 0;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 2px;
}

.me-item__main strong {
  font-size: var(--fs-body);
  font-weight: 600;
}

.me-item__main small {
  overflow: hidden;
  color: var(--ink-3);
  font-size: var(--fs-micro);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.me-item__arrow {
  color: var(--ink-3);
  font-size: 24px;
  line-height: 1;
}

</style>