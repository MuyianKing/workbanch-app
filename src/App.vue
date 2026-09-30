<!--
  应用外壳：背景光斑、安全区、提示消息的宿主。

  **启动顺序是有讲究的**：
   1. `settings.init()` —— 先把主题铺到 `<html data-theme>` 上。放到后面的话，
      深色用户会先看到一帧白底，那一下闪白比什么都显眼；
   2. `vault.init()` —— **不 await**：它里头可能有一次网络同步，等它回来再画界面
      会白屏好几秒。界面自己会显示「正在读取本机密钥…」那一态；
   3. 取安全区并写进 CSS 变量。

  安全区只在**进 App 时**与**转屏时**取：键盘弹出引起的 resize 不会改变安全区，
  而那个事件会在每次输入时炸一大串，跟着取一遍纯属白费。
-->

<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'
import ToastHost from '@/components/ui/ToastHost.vue'
import VaultView from '@/views/VaultView.vue'
import { getSafeArea, initShell, isInApp } from '@/bridge/handlers'
import { setSafeArea } from '@/storage'
import type { SafeArea } from '@/bridge/types'
import { useSettingsStore } from '@/stores/settings'
import { useVaultStore } from '@/stores/vault'

const settingsStore = useSettingsStore()
const vaultStore = useVaultStore()

/** 把安全区落到 CSS 变量上。左右取大的一边 —— 横屏时刘海只在一侧，两边都让出这么多才对称 */
function applySafeArea(area: SafeArea): void {
  setSafeArea(area)
  const style = document.documentElement.style
  style.setProperty('--safe-top', `${area.top}px`)
  style.setProperty('--safe-bottom', `${area.bottom}px`)
  style.setProperty('--safe-side', `${Math.max(area.left, area.right)}px`)
}

async function refreshSafeArea(): Promise<void> {
  // 浏览器里没有壳，也就不存在安全区，不必白问一次
  if (!isInApp()) return
  applySafeArea(await getSafeArea())
}

onMounted(async () => {
  settingsStore.init()
  void vaultStore.init()

  const shell = await initShell(settingsStore.settings.statusBarColor)
  applySafeArea(shell.safeArea)

  window.addEventListener('orientationchange', refreshSafeArea)
})

onBeforeUnmount(() => {
  window.removeEventListener('orientationchange', refreshSafeArea)
})
</script>

<template>
  <div class="app">
    <!--
      背景光斑：**它就是「毛玻璃底下有东西」的答案**。装饰性的，所以整块 aria-hidden。
      伪元素只有两个，第三个光斑得另起一层元素（见 main.css）。
    -->
    <div class="app__aura" aria-hidden="true">
      <span class="app__aura-extra" />
    </div>

    <VaultView />
    <ToastHost />
  </div>
</template>

<style scoped>
.app {
  position: relative;
  min-height: 100%;
}
</style>