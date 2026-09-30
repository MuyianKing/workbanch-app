/**
 * 设置面板：同步配置、外观、关于。密码显示偏好归密码页管理。
 *
 * **它不碰 store，只认 props 与 emit**：这样这一屏能单独摆出来看（改样式时不用先建库、先解锁），
 * 也让「改设置」这件事只有一个出口 —— 父组件收 `change` 那一下。
 *
 * 三处刻意的取舍：
 *  - 同步的仓库、分支、令牌**每改一格就存**，没有「保存」按钮 —— 手机上多一步确认没有收益，
 *    而这一屏没有任何一步是不可逆的；
 *  - 状态栏颜色只给几个深色预设（不给取色器）：壳把状态栏的文字写死成白色，浅底会让时间与电量看不见，
 *    与其让用户选出一个看不见字的状态栏，不如不给那个选项；
 *  - 「重置」只清设置（仓库、令牌、外观），**不动密钥、不动记录** —— 那两样是数据，不是设置。
 */

<script setup lang="ts">
import AppField from '@/components/ui/AppField.vue'
import type { Settings, ThemeMode } from '@/storage'

const props = defineProps<{
  settings: Settings
  /** 上一轮同步的结果那句话 */
  syncNote: string
  syncFailed: boolean
}>()

const emit = defineEmits<{ change: [patch: Partial<Settings>] }>()

const THEMES: { value: ThemeMode; label: string }[] = [
  { value: 'system', label: '跟随系统' },
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' }
]

/** 状态栏底色预设。全部是深色，理由见本文件头部 */
const BAR_COLORS = [
  { value: '#14161b', label: '深墨' },
  { value: '#101828', label: '深蓝' },
  { value: '#1b1030', label: '深紫' },
  { value: '#0f1f1a', label: '深绿' }
]

const BRANCHES = ['master', 'main']
</script>

<template>
  <div class="panel">
    <!-- ---------- 同步 ---------- -->
    <section class="panel__section">
      <h3 class="panel__title">同步</h3>
      <p class="panel__desc">
        记录加密之后放进 Gitee 仓库里的 <code class="mono">vault/vault.json</code>，与桌面端 Workbench 是同一份。
        这里只填「放在哪儿」和「凭什么进去」——内容始终由这台设备加密。
      </p>

      <div class="panel__fields">
        <AppField
          :model-value="props.settings.repo"
          label="仓库"
          placeholder="owner/repo，也可以粘整条 gitee 地址"
          @update:model-value="emit('change', { repo: $event })"
        />
        <AppField
          :model-value="props.settings.branch"
          label="分支"
          placeholder="master"
          @update:model-value="emit('change', { branch: $event })"
        />
        <div class="chips">
          <button
            v-for="name in BRANCHES"
            :key="name"
            type="button"
            class="chip"
            :class="{ 'is-active': props.settings.branch.trim() === name }"
            @click="emit('change', { branch: name })"
          >
            {{ name }}
          </button>
        </div>
        <AppField
          :model-value="props.settings.token"
          type="password"
          mono
          label="私人令牌"
          placeholder="Gitee 设置 → 私人令牌"
          hint="需要 projects 的读写权限。令牌只存在这台设备上，只在同步时发给 Gitee。"
          @update:model-value="emit('change', { token: $event })"
        />
      </div>

      <p v-if="syncNote" class="panel__note" :class="{ 'is-failed': syncFailed }">{{ syncNote }}</p>
    </section>

    <!-- ---------- 外观 ---------- -->
    <section class="panel__section">
      <h3 class="panel__title">外观</h3>

      <div class="panel__fields">
        <div class="row">
          <span class="row__label">主题</span>
          <div class="seg">
            <button
              v-for="item in THEMES"
              :key="item.value"
              type="button"
              class="seg__item"
              :class="{ 'is-active': props.settings.theme === item.value }"
              @click="emit('change', { theme: item.value })"
            >
              {{ item.label }}
            </button>
          </div>
        </div>

        <div class="row row--stack">
          <span class="row__label">状态栏底色</span>
          <div class="swatches">
            <button
              v-for="item in BAR_COLORS"
              :key="item.value"
              type="button"
              class="swatch"
              :class="{ 'is-active': props.settings.statusBarColor.toLowerCase() === item.value }"
              :style="{ background: item.value }"
              :aria-label="item.label"
              :title="item.label"
              @click="emit('change', { statusBarColor: item.value })"
            />
          </div>
          <p class="panel__hint">只给深色：壳把状态栏的文字固定成白色，浅底会让时间与电量看不清。</p>
        </div>

      </div>
    </section>

  </div>
</template>

<style scoped>
.panel {
  display: flex;
  flex-direction: column;
  gap: var(--sp-6);
}

.panel__section {
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
}

.panel__title {
  margin: 0;
  color: var(--ink);
  font-size: var(--fs-body);
  font-weight: 600;
}

.panel__desc {
  margin: 0;
  color: var(--ink-3);
  font-size: var(--fs-micro);
  line-height: 1.7;
}

.panel__desc code {
  padding: 0 4px;
  border-radius: 6px;
  background: var(--glass-soft);
  font-size: var(--fs-micro);
}

.panel__fields {
  display: flex;
  flex-direction: column;
  gap: var(--sp-4);
}

.panel__hint {
  margin: 0;
  color: var(--ink-3);
  font-size: var(--fs-micro);
}

/* 同步结果那句话：失败时是红的，成功时照旧是灰的（成功不需要抢注意力） */
.panel__note {
  margin: 0;
  padding: var(--sp-2) var(--sp-3);
  border-radius: var(--r-sm);
  background: var(--glass-soft);
  color: var(--ink-2);
  font-size: var(--fs-micro);
  line-height: 1.6;
}

.panel__note.is-failed {
  background: var(--danger-soft);
  color: var(--danger);
}

/* ---------- 一行「标签 + 控件」 ---------- */

.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-4);
}

.row--stack {
  flex-direction: column;
  align-items: flex-start;
  gap: var(--sp-3);
}

.row__label {
  color: var(--ink-2);
  font-size: var(--fs-body);
}

.row__sub {
  display: block;
  margin-top: 2px;
  color: var(--ink-3);
  font-size: var(--fs-micro);
  font-style: normal;
}

.row .seg {
  flex: 0 1 240px;
}

/* ---------- 状态栏色块 ---------- */

.swatches {
  display: flex;
  gap: var(--sp-3);
}

.swatch {
  width: 34px;
  height: 34px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  cursor: pointer;
  /* 亮边让深色块在浅色主题下也看得出边界 */
  box-shadow: 0 0 0 1px var(--line-strong) inset, var(--shadow-sm);
  transition: transform 0.14s ease, box-shadow 0.16s ease;
}

.swatch:active {
  transform: scale(0.92);
}

.swatch.is-active {
  box-shadow: 0 0 0 2px var(--bg), 0 0 0 4px var(--accent);
}

</style>