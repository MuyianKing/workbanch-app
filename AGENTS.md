# AGENTS.md — 密码备忘 H5 App

## 项目定位

纯 H5 单页应用，运行环境是 `E:\muyian\base-app` 的 `web-view`。核心功能是与 Workbench 桌面端「密码保险库」互通的密码备忘。

## 技术栈

- Vue 3 + TypeScript + Vite
- Element Plus（移动模式）
- Pinia（状态管理）
- Web Crypto API（加密）
- uni.webview.js（与 base-app 通信）

## 硬性约束

### 1. 不新增编译单元

不引入任何 Rust/原生侧加密库。所有加密用 Web Crypto API（ ECDH P-256 / HKDF-SHA256 / AES-256-GCM )。

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

- 私钥只存 `localStorage`(base64 编码，用户已确认此方案）
- 不发送网络、不写日志、不打印到控制台
- 加解密只在内存中进行

### 5. 桥命令只增不改

base-app 已支持的命令：
- `getEnv` → `'pad'`
- `getSafeArea` → `{ top, bottom, left, right }`
- `setStatusBarColor` `{ color }` → `true`

新增命令需在 base-app 的 `bridge/handlers.js` 中同步添加 handler。

### 6. UI 组件复用

- 卡片：`src/components/VaultCard.vue`
- 弹框：`src/components/AppDialog.vue`（基础）, `VaultEntryDialog.vue`（条目）, `VaultKeyDialog.vue`（密钥）
- 设置：`src/components/SettingsPanel.vue`

不另起样式体系，新组件优先复用现有结构。

## 目录结构与职责

```
src/
├── views/VaultView.vue       # 主页面：状态机 + 卡片墙
├── components/               # 可复用 UI 组件
├── stores/vault.ts           # Pinia store：保险库状态与动作
├── bridge/                   # base-app 通信
│   ├── client.ts             # 发送/接收/回调管理
│   └── handlers.ts           # 命令封装
├── sync/
│   ├── gitee.ts              # Gitee API 读写
│   └── merge.ts              # 合并逻辑（纯函数）
├── vault/
│   ├── crypto.ts             # ECIES 加解密
│   ├── file.ts               # vault.json 解析与生成
│   └── key.ts                # 密钥串编解码
└── styles/main.css           # 毛玻璃主题变量
```

## 代码风格

- 所有模块注释用中文，解释「为什么这么做」而非「做了什么」
- 函数/变量命名用英文，与 Workbench 保持一致（如 `seal/open`, `mergeVaultItems` )
- 每个 `.ts` 文件头部必须有块注释说明模块职责
- Vue 组件用 `<script setup lang="ts">`

## 测试要求

- `vault/crypto.ts`：加解密往返测试
- `sync/merge.ts`：合并确定性测试（两台设备输入相同，输出必须逐字节一致）
- `vault/key.ts`：密钥串编解码测试

## 与 Workbench 的互操作验证

每次修改以下文件后，必须验证与 Workbench 的数据互通：
- `src/vault/crypto.ts`
- `src/vault/file.ts`
- `src/vault/key.ts`
- `src/sync/merge.ts`

验证步骤：
1. 在 Workbench 导出密钥文件
2. 在本 App 导入该密钥
3. 在 Workbench 添加/修改/删除一条记录
4. 在本 App 同步，确认数据一致
5. 反向操作一次
