/**
 * 一张密码卡片。
 *
 * **卡片上只摆名字与密码**：备注是一句随手记下的话，长短不定，摊上去这几张卡就高矮不齐、
 * 整面墙的节奏散掉；它照旧记着，在编辑弹层里看与改。卡片是**用**的地方：看一眼、复制一下。
 *
 * **密码默认遮住**，按那颗眼睛才现形；遮罩是**固定长度**的，不按真实长度铺点 ——
 * 长度也是信息，没必要替用户说出去。
 *
 * 复制与查看是两颗独立按钮（用户要的就是这两个动作，合成一颗反而多一步）。
 * 改与删收进「⋯」：那是偶尔才做一次的事，不该占着卡片最显眼的位置。
 */

<script setup lang="ts">
import { computed } from 'vue'
import type { VaultRecord } from '@/vault/file'

const props = defineProps<{
  record: VaultRecord
  /** 这一张正把密码亮着 */
  revealed: boolean
  /** 遮罩串（由父组件给，全墙用同一个，改口径只改一处） */
  mask: string
}>()

const emit = defineEmits<{
  toggleReveal: []
  copyPassword: []
  menu: []
}>()

/** 备注不摆上卡片，但要让人知道「这条还有别的」—— 名字旁边一个小圆点即可 */
const hasNotes = computed(() => Boolean(props.record.notes.trim()))
</script>

<template>
  <article class="card">
    <header class="card__head">
      <h3 class="card__name" :title="record.name">{{ record.name }}</h3>
      <span v-if="hasNotes" class="card__dot" title="这条有备注" aria-label="这条有备注" />
      <button type="button" class="card__more" aria-label="更多操作" @click="emit('menu')">
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <circle cx="5" cy="12" r="1.7" fill="currentColor" />
          <circle cx="12" cy="12" r="1.7" fill="currentColor" />
          <circle cx="19" cy="12" r="1.7" fill="currentColor" />
        </svg>
      </button>
    </header>

    <div class="row">
      <span class="row__value" :class="{ 'row__value--plain': revealed }">{{ revealed ? record.password || '—' : mask }}</span>

      <span class="row__ops">
        <button
          type="button"
          class="row__op"
          :disabled="!record.password"
          :aria-label="record.password ? '复制密码' : '这条没记密码'"
          @click="emit('copyPassword')"
        >
          <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">
            <rect x="9" y="9" width="11" height="11" rx="2.4" fill="none" stroke="currentColor" stroke-width="1.6" />
            <path
              d="M15 6.5A2.5 2.5 0 0 0 12.5 4h-6A2.5 2.5 0 0 0 4 6.5v6A2.5 2.5 0 0 0 6.5 15"
              fill="none"
              stroke="currentColor"
              stroke-width="1.6"
              stroke-linecap="round"
            />
          </svg>
        </button>

        <button
          type="button"
          class="row__op"
          :disabled="!record.password"
          :aria-label="revealed ? '隐藏密码' : '查看密码'"
          @click="emit('toggleReveal')"
        >
          <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">
            <template v-if="revealed">
              <path d="M4 4l16 16M6.5 6.9C4.4 8.4 3 12 3 12s3.5 6 9 6c1.6 0 3-.4 4.2-1.1M17.6 17c1.9-1.5 3.4-5 3.4-5s-3.5-6-9-6c-.9 0-1.7.1-2.4.4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
            </template>
            <template v-else>
              <path d="M3 12s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6z" fill="none" stroke="currentColor" stroke-width="1.6" />
              <circle cx="12" cy="12" r="2.6" fill="none" stroke="currentColor" stroke-width="1.6" />
            </template>
          </svg>
        </button>
      </span>
    </div>
  </article>
</template>

<style scoped>
.card {
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
  padding: var(--sp-4);
  border: 1px solid var(--glass-edge);
  border-radius: var(--r-md);
  background: var(--glass);
  box-shadow: var(--shadow-sm);
  transition: box-shadow 0.18s ease, transform 0.18s ease, border-color 0.18s ease;
}

.card:active {
  transform: scale(0.994);
}

.card__head {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  min-height: 30px;
}

.card__name {
  flex: 1 1 auto;
  min-width: 0;
  margin: 0;
  overflow: hidden;
  color: var(--ink);
  font-size: var(--fs-body);
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 「这条有备注」的小圆点：一个提示，不是内容 */
.card__dot {
  flex-shrink: 0;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--accent);
  opacity: 0.7;
}

/* 「⋯」常显（手机上本来就没有悬停），但压低存在感 */
.card__more {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  margin-right: -6px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--ink-3);
  cursor: pointer;
}

.card__more:active {
  background: var(--glass-soft);
  color: var(--ink);
}

/* ---------- 密码那一行 ---------- */

/*
 * 标签、值、两颗图标都落在同一条 22px 的带子上 —— 各自按各自的盒子居中会出现三条中线，
 * 一行里三个高度看着就是没对齐（桌面端踩过这个坑，这里沿用同一个口径）。
 */
.row {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  min-width: 0;
}

.row__value {
  flex: 1 1 auto;
  min-width: 0;
  color: var(--ink-3);
  /* 遮罩是八颗点，用比例字体比等宽好看（等宽的圆点间距太大） */
  font-size: var(--fs-body);
  letter-spacing: 0.14em;
  line-height: 22px;
  user-select: text;
}

/* 亮着时换成等宽 + 允许换行：查看密码就是为了读全，截断等于白看 */
.row__value--plain {
  color: var(--ink);
  font-family: var(--font-mono);
  font-size: var(--fs-meta);
  letter-spacing: 0.02em;
  overflow-wrap: anywhere;
}

.row__ops {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: var(--sp-1);
  color: var(--ink-3);
}

.row__op {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  padding: 0;
  border: 0;
  border-radius: var(--r-sm);
  background: transparent;
  color: inherit;
  cursor: pointer;
  transition: background 0.16s ease, color 0.16s ease, opacity 0.16s ease;
}

.row__op:active:not(:disabled) {
  background: var(--glass-soft);
  color: var(--ink);
}

/* 没记密码时两颗按钮都是灰的 —— 但它们还在，用户看得出「这里本来有操作」 */
.row__op:disabled {
  opacity: 0.32;
  cursor: not-allowed;
}
</style>