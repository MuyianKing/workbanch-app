import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// 构建产物直接落进 base-app 的 hybrid/html：App 离线也能起来（web-view 加载本地文件）
// base 用相对路径 —— file:// 下绝对路径 /assets/... 会指到文件系统根目录
export default defineConfig({
  base: './',
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // 关掉 sourcemap：产物要随 App 打包，多出来的 .map 只会撑大体积
    sourcemap: false,
    rollupOptions: {
      output: {
        // 库与业务代码分开：升级依赖时那份 vendor 的缓存才有意义
        // （这里**没有 element-plus** —— 界面是手写的，见 AGENTS.md 第 6 节）
        manualChunks: {
          vendor: ['vue', 'pinia']
        }
      }
    }
  },
  /*
   * 这一段归 vitest 读，**不在 `vue-tsc` 的检查范围里**：vitest 装了一份自己的 vite，
   * 与根上这份 vite 是同一个包的两份类型，凑在一起每个字段都会报「类型不兼容」。
   * 与其为了让它过检查去降 vite，不如把这份配置文件交给 vite 自己转译（见 tsconfig.json 的 include）。
   */
  test: {
    // 单测全在纯逻辑层（加解密、合并、编解码），**不需要 DOM**：
    // 它们的运行环境就是 Node，而 Node 自带与 WebView2 同一套 WebCrypto
    environment: 'node',
    include: ['src/**/*.test.ts'],
    globals: true
  }
})