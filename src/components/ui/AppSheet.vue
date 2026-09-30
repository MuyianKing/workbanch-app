/**
 * 基础弹层：**窄屏是底部抽屉，宽屏是居中卡片**。
 *
 * 为什么不是「到处居中的对话框」：手机上大拇指够不到屏幕上半部分，居中的弹框
 * 把按钮放在最远的地方；底部抽屉把内容与按钮拉到手指边上，这才是移动端的惯例。
 * 而平板上居中又更自然（屏幕大，抽屉会拉成一条奇怪的横幅），所以按宽度切换。
 *
 * 三件必须做的事，都在下面处理了：
 *  - **锁住背后的滚动** —— 不锁的话手指滑到抽屉外面会滚动列表，看着像抽屉漏了；
 *  - **点遮罩 / 按 Esc 关闭**，但 `dismissible` 为假时不行（正在保存、或里面有没提交的输入）；
 *  - **底部留出安全区** —— 手势条正好压在按钮那一行上。
 */

<script setup lang="ts">
import { onBeforeUnmount, watch } from 'vue'

const visible = defineModel<boolean>('visible', { required: true })

const props = withDefaults(
  defineProps<{
    title: string
    /** 标题下那一句说明，可省略 */
    description?: string
    /** 点遮罩 / 按 Esc 能不能关。正在保存或正在输入时传 false */
    dismissible?: boolean
    /** 内容很高时用 tall：抽屉几乎顶到屏幕上方 */
    tall?: boolean
  }>(),
  { description: '', dismissible: true, tall: false }
)

const emit = defineEmits<{ opened: []; closed: [] }>()

/** 关掉时把背后的滚动还回去。**只在打开过之后才还原**，否则会把别处的滚动状态弄丢 */
function setScrollLock(locked: boolean): void {
  document.body.style.overflow = locked ? 'hidden' : ''
}

function close(): void {
  if (!props.dismissible) return
  visible.value = false
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') close()
}

watch(
  visible,
  (open) => {
    if (open) {
      setScrollLock(true)
      window.addEventListener('keydown', onKeydown)
      emit('opened')
    } else {
      setScrollLock(false)
      window.removeEventListener('keydown', onKeydown)
      emit('closed')
    }
  },
  { immediate: true }
)

// 组件被卸载时（比如整页切走）不能把滚动锁留在 body 上
onBeforeUnmount(() => {
  setScrollLock(false)
  window.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <Teleport to="body">
    <Transition name="sheet">
      <div v-if="visible" class="sheet" role="dialog" aria-modal="true" :aria-label="title">
        <div class="sheet__mask" @click="close" />

        <div class="sheet__panel" :class="{ 'is-tall': tall }">
          <header class="sheet__head">
            <div class="sheet__titles">
              <h2 class="sheet__title">{{ title }}</h2>
              <p v-if="description" class="sheet__desc">{{ description }}</p>
            </div>
            <button v-if="dismissible" type="button" class="sheet__close" aria-label="关闭" @click="close">
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                <path
                  d="M6 6l12 12M18 6L6 18"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.8"
                  stroke-linecap="round"
                />
              </svg>
            </button>
          </header>

          <div class="sheet__body">
            <slot />
          </div>

          <footer v-if="$slots.footer" class="sheet__foot">
            <slot name="footer" />
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.sheet {
  position: fixed;
  inset: 0;
  z-index: 8000;
  display: flex;
  align-items: flex-end;
  justify-content: center;
}

.sheet__mask {
  position: absolute;
  inset: 0;
  background: rgba(8, 10, 18, 0.42);
  backdrop-filter: blur(2px);
  -webkit-backdrop-filter: blur(2px);
}

.sheet__panel {
  position: relative;
  display: flex;
  flex-direction: column;
  width: 100%;
  max-height: 88vh;
  padding: var(--sp-3) var(--sp-5) calc(var(--sp-5) + var(--safe-bottom));
  border: 1px solid var(--glass-edge);
  border-bottom: 0;
  border-radius: var(--r-xl) var(--r-xl) 0 0;
  background: var(--glass-strong);
  box-shadow: var(--shadow-lg);
  backdrop-filter: blur(var(--blur)) saturate(180%);
  -webkit-backdrop-filter: blur(var(--blur)) saturate(180%);
}

.sheet__panel.is-tall {
  max-height: 94vh;
}

/* 抽屉顶部那道「抓手」：让「这是一块能拖走的东西」一眼可见 */
.sheet__panel::before {
  content: '';
  display: block;
  width: 38px;
  height: 4px;
  margin: 0 auto var(--sp-3);
  border-radius: 999px;
  background: var(--line-strong);
}

.sheet__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--sp-3);
  padding-bottom: var(--sp-4);
}

.sheet__titles {
  min-width: 0;
}

.sheet__title {
  margin: 0;
  color: var(--ink);
  font-size: var(--fs-title);
  font-weight: 600;
}

.sheet__desc {
  margin: var(--sp-1) 0 0;
  color: var(--ink-3);
  font-size: var(--fs-meta);
  line-height: 1.6;
}

.sheet__close {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: var(--glass-soft);
  color: var(--ink-3);
  cursor: pointer;
}

.sheet__body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  /* 内容贴边滚动时不要横向抖动 */
  overscroll-behavior: contain;
}

.sheet__foot {
  display: flex;
  gap: var(--sp-3);
  padding-top: var(--sp-4);
}

.sheet__foot :deep(.btn) {
  flex: 1 1 0;
}

/* ---------- 宽屏：居中卡片 ---------- */

@media (min-width: 720px) {
  .sheet {
    align-items: center;
    padding: var(--sp-6);
  }

  .sheet__panel {
    max-width: 480px;
    max-height: 86vh;
    border-bottom: 1px solid var(--glass-edge);
    border-radius: var(--r-xl);
  }

  .sheet__panel.is-tall {
    max-height: 90vh;
  }

  /* 居中时不要那道抓手 */
  .sheet__panel::before {
    display: none;
  }
}

/* ---------- 进出场 ---------- */

.sheet-enter-active,
.sheet-leave-active {
  transition: opacity 0.22s ease;
}

.sheet-enter-active .sheet__panel,
.sheet-leave-active .sheet__panel {
  transition: transform 0.28s cubic-bezier(0.32, 1, 0.5, 1);
}

.sheet-enter-from,
.sheet-leave-to {
  opacity: 0;
}

.sheet-enter-from .sheet__panel,
.sheet-leave-to .sheet__panel {
  transform: translateY(6%);
}

@media (min-width: 720px) {
  .sheet-enter-from .sheet__panel,
  .sheet-leave-to .sheet__panel {
    transform: translateY(0) scale(0.96);
  }
}
</style>