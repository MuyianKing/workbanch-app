/**
 * 提示消息的宿主：把 `toast.ts` 里那个数组画出来。**在 App.vue 里挂一次**，
 * 其余组件只管调 `notifySuccess` 那几个函数，不关心消息画在哪儿。
 *
 * 位置上贴着**顶部**（安全区之下）：手机上手指与键盘都占着下半屏，
 * 消息出现在下面会被挡住 —— 而它本来就是「抬头看一眼」的东西。
 */

<script setup lang="ts">
import { dismiss, toasts } from '@/toast'

const ICON: Record<string, string> = {
  success: '✓',
  info: 'i',
  error: '!'
}
</script>

<template>
  <Teleport to="body">
    <!-- aria-live：读屏用户也要知道「已复制」这类反馈 -->
    <div class="toasts" role="status" aria-live="polite">
      <TransitionGroup name="toast">
        <button
          v-for="toast in toasts"
          :key="toast.id"
          type="button"
          class="toast"
          :class="`toast--${toast.kind}`"
          @click="dismiss(toast.id)"
        >
          <span class="toast__icon" aria-hidden="true">{{ ICON[toast.kind] }}</span>
          <span class="toast__text">{{ toast.text }}</span>
        </button>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<style scoped>
.toasts {
  position: fixed;
  top: calc(var(--safe-top) + 10px);
  left: 50%;
  z-index: 9000;
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  width: max-content;
  max-width: calc(100vw - 32px);
  transform: translateX(-50%);
  pointer-events: none;
}

.toast {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  padding: var(--sp-2) var(--sp-4) var(--sp-2) var(--sp-3);
  border: 1px solid var(--glass-edge);
  border-radius: 999px;
  background: var(--glass-strong);
  box-shadow: var(--shadow);
  backdrop-filter: blur(var(--blur)) saturate(180%);
  -webkit-backdrop-filter: blur(var(--blur)) saturate(180%);
  color: var(--ink);
  font-family: inherit;
  font-size: var(--fs-meta);
  text-align: left;
  cursor: pointer;
  pointer-events: auto;
}

.toast__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--accent);
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  line-height: 1;
}

.toast--error .toast__icon {
  background: var(--danger);
}

.toast--info .toast__icon {
  background: var(--ink-3);
}

.toast__text {
  min-width: 0;
  overflow-wrap: anywhere;
}

/* 进出都是「从上面掉下来」：与它贴着顶部的位子对得上 */
.toast-enter-active,
.toast-leave-active {
  transition: opacity 0.22s ease, transform 0.22s cubic-bezier(0.34, 1.3, 0.64, 1);
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(-12px) scale(0.96);
}
</style>