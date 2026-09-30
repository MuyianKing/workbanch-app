/**
 * 入口：挂 Pinia、挂根组件。
 *
 * **只做这两件事**：任何「启动时要准备的东西」都在 `App.vue` 的 onMounted 里，
 * 这样它们能拿到组件上下文、也能在失败时如实往界面上说一句，而不是在模块顶层静默地炸掉。
 */

import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import './styles/main.css'

createApp(App).use(createPinia()).mount('#app')