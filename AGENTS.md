# AGENTS.md — 密码备忘 H5 App

## 项目定位

纯 H5 单页应用，运行环境是 `E:\muyian\base-app` 的 `web-view`。核心功能是与 Workbench 桌面端「密码保险库」互通的密码备忘。

## 技术栈

- Vue 3（`<script setup>`）+ TypeScript + Vite
- **Pinia**（状态管理）
- **Web Crypto API**（加密：ECDH P-256 / HKDF-SHA256 / AES-256-GCM）
- **uni.webview.js**（与 base-app 通信）
- Vitest + jsdom（单测，环境是 node —— 纯逻辑层不需要 DOM）
- **手写移动端 UI 组件**（不用 Element Plus）

## 硬性约束

### 1. 不新增编译单元

不引入任何 Rust/原生侧加密库。所有加密用 Web Crypto API。

### 2. 数据格式与 Workbench 冻结兼容

- 密钥串前缀：`workbench-vault-v1.`
- HKDF info：`workbench-vault-v1`
- 文件路径：`vault/vault.json`
- 信封字段：`version`, `key`, `items[]`（含 `id`, `updatedAt`, `by`, `deleted?`, `pub?`, `iv?`, `ct?` )

任何字段变更必须同时修改 Workbench 与本项目，并提升 `VAULT_VERSION`。

### 3. 合并规则必须是纯函数

`src/sync/merge.ts` 中的 `mergeVaultItems`:
- 按 `id` 取并集
- 同 `id` 取 `updatedAt` 大的；相等则取 `by` 字典序大的
- 删除留墓碑（ `deleted: true` )，永不清理
- 输出按 `id` 升序排序

**禁止**出现「以本地为准」或「以远端为准」的逻辑。

### 4. 密钥安全

- 私钥只存 `localStorage`（base64 编码，用户已确认此方案）
- 不发送网络、不写日志、不打印到控制台
- 加解密只在内存中进行

### 5. 桥命令只增不改

base-app 已支持的命令：
- `getEnv` → `'pad'`
- `getSafeArea` → `{ top, bottom, left, right }`
- `setStatusBarColor` `{ color }` → `true`

新增命令需在 base-app 的 `bridge/handlers.js` 中同步添加 handler。

### 6. UI 组件复用（不用 Element Plus）

毛玻璃拟物 + 手写移动端控件（`src/components/ui/` 一层通用件）：
- 通用 UI：`ui/AppSheet.vue`（弹层）、`ui/AppField.vue`（带标签输入）、`ui/ToastHost.vue`（顶部提示）
- 业务组件：`VaultCard.vue`（卡片）、`VaultEntryDialog.vue`（添加/编辑）、`VaultKeyDialog.vue`（密钥）、`SettingsPanel.vue`（设置）

所有颜色/圆角/模糊都从 `styles/main.css` 里的设计令牌取，组件里只写结构。

## 目录结构与职责

```
src/
├── main.ts                   # 入口（挂 Pinia、挂根组件、import main.css）
├── App.vue                   # 外壳：启动顺序、背景光斑、安全区、ToastHost
├── views/VaultView.vue       # 主页面：状态机 + 卡片墙 + 顶栏 + 抽屉
├── components/
│   ├── VaultCard.vue         # 卡片
│   ├── VaultEntryDialog.vue  # 添加 / 编辑弹层
│   ├── VaultKeyDialog.vue    # 密钥管理弹层
│   ├── SettingsPanel.vue     # 设置（同步 / 外观 / 关于）
│   └── ui/
│       ├── AppSheet.vue      # 基础弹层（窄屏底部抽屉 / 宽屏居中卡片）
│       ├── AppField.vue      # 带标签的输入栏（text / password / textarea / url）
│       └── ToastHost.vue     # 顶部 toast 的宿主
├── stores/
│   ├── vault.ts              # Pinia store：保险库状态与动作
│   └── settings.ts           # 设置 store（主题同步 / 同步配置 ready 判断）
├── bridge/
│   ├── types.ts              # BridgePayload、SafeArea 类型
│   ├── client.ts             # 桥客户端：发消息 / 等回包 / 5 秒超时
│   └── handlers.ts           # getEnv / getSafeArea / setStatusBarColor / initShell
├── sync/
│   ├── merge.ts              # 合并逻辑（纯函数，带单测）
│   ├── gitee.ts              # Gitee contents API 读写
│   └── vault.ts              # 编排层：本机文件、密钥生命周期、同步 pull-merge-push
├── vault/
│   ├── base64.ts             # base64 / base64url / utf8 编解码
│   ├── key.ts                # 密钥串编解码 + 公钥指纹
│   ├── crypto.ts             # ECIES seal / open / openAll
│   └── file.ts               # vault.json 解析与生成 + 分组 / 排序 / 过滤
├── clipboard.ts              # 复制到剪贴板（两条路都走：clipboard API + execCommand 兜底）
├── result.ts                 # Result<T> / ok / fail / reasonOf
├── storage.ts                # 本机存储：密钥 / 设备 id / 设置 / 安全区（内存）
├── toast.ts                  # 顶部 toast 的响应式数组 + 三个 notify 函数
├── types.ts                  # VaultKeyState / VaultLoaded / VaultSyncOutcome
└── styles/main.css           # 毛玻璃设计令牌 + 通用控件（.btn / .field / .seg / .switch / .chip）
```

构建产物落 `dist/`（`npm run build`），可直接拷到 base-app 的 `hybrid/html/`。`public/bridge/uni.webview.js` 原样出现在产物里（**不打包进 bundle**）。

## 代码风格

- 所有模块注释用中文，解释「为什么这么做」而非「做了什么」
- 函数 / 变量命名用英文，与 Workbench 保持一致（如 `seal/open`, `mergeVaultItems`）
- 每个 `.ts` 文件头部必须有块注释说明模块职责
- Vue 组件用 `<script setup lang="ts">`
- 不引入 pnpm —— 项目用 `npm install`

## 测试要求

`vitest run`（env=node）：
- `vault/crypto.test.ts`（7 个）：加解密往返 / 一次一密 / 换密钥解不开 / 改一字节解不开
- `vault/key.test.ts`（18 个）：密钥串编解码 / 前缀校验 / 私钥形状 / 指纹稳定唯一
- `sync/merge.test.ts`（8 个）：合并确定性（两台设备输入相同，输出必须逐字节一致）

`vue-tsc --noEmit` 必过。**vite.config.ts 不进 `vue-tsc` 的检查范围**（它用 vitest 那份 vite 的 test 段类型，与根 vite 的类型凑不到一起；`tsconfig.json` 里只 include `src/**/*`）。

## 与 Workbench 的互操作验证

每次修改以下文件后，必须验证与 Workbench 的数据互通：
- `src/vault/crypto.ts`
- `src/vault/file.ts`
- `src/vault/key.ts`
- `src/sync/merge.ts`

验证步骤：
1. 在 Workbench 导出密钥文件
2. 在本 App 导入该密钥
3. 在 Workbench 添加 / 修改 / 删除一条记录
4. 在本 App 同步，确认数据一致
5. 反向操作一次