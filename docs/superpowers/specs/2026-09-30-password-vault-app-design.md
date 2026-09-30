# 密码备忘 H5 App — 设计文档

## 1. 定位与范围

- **产品形态**:纯 H5 单页应用(Vue 3 + TypeScript),最终打包进 `E:\muyian\base-app` 的 `web-view`。
- **核心功能**:与 Workbench 桌面端「密码保险库」完全互通的密码备忘。
- **不做的事**:不生成密码、不填用户名/网址字段、不做生物识别、不做云备份(只走 Gitee 同步)。

## 2. 关键决策(已确认)

| 决策项 | 结论 | 理由 |
|--------|------|------|
| 同步方式 | Gitee HTTP API 读写 `vault/vault.json` | 不依赖 base-app 桥扩展,可跨设备;复用 Workbench 同一仓库 |
| 密钥存储 | `localStorage` base64 编码 | 用户明确选择,实现最简单;风险在 README 中声明 |
| UI 风格 | 现代毛玻璃拟物(深色/浅色随系统) | 已确认 |
| 布局参考 | 自由发挥,不照搬 Workbench | 已确认 |
| 密码可见性 | 眼睛图标切换,默认固定 8 点遮罩 | 已确认 |
| 同步时机 | 启动自动 + 下拉手势 + 手动按钮 | 已确认 |
| 设置项 | 仓库路径、分支、token、主题、状态栏颜色 | 已确认 |

## 3. 技术栈

- **框架**:Vue 3 + TypeScript + Vite
- **UI 库**:Element Plus(移动模式适配)
- **状态**:Pinia
- **加密**:Web Crypto API( ECDH P-256 / HKDF-SHA256 / AES-256-GCM )
- **桥接**:uni.webview.1.5.6.js + base-app 自定义 message 协议

## 4. 数据格式(与 Workbench 逐字节兼容)

### 4.1 密钥串
```
workbench-vault-v1.<base64url(JSON.stringify(VaultPrivateKey))>
```
私钥 JWK 含 `kty: 'EC'`, `crv: 'P-256'`, `x`, `y`, `d`。

### 4.2 条目正文(密文里)
```json
{ "name": "...", "password": "...", "notes": "...", "group": "..." }
```

### 4.3 信封(明文)
```json
{
  "version": 1,
  "key": { "kty": "EC", "crv": "P-256", "x": "...", "y": "..." },
  "items": [
    {
      "id": "uuid",
      "updatedAt": 1234567890,
      "by": "device-id",
      "deleted": true,
      "pub": "...", "iv": "...", "ct": "..."
    }
  ]
}
```

### 4.4 加解密流程( ECIES )
- **加密(seal)**:现场生成临时 ECDH 密钥对 → 与主公钥 deriveBits → HKDF( salt=32 零字节, info='workbench-vault-v1' ) → AES-256-GCM 加密正文 → 输出 `{ pub: 临时公钥 raw, iv, ct }`,全部 base64url。
- **解密(open)**:用私钥与信封里的 `pub` deriveBits → 同样 HKDF → AES-256-GCM 解密。

### 4.5 合并规则(与 Workbench `mergeVaultItems` 一致)
- 按 `id` 取并集
- 同 `id` 取 `updatedAt` 大的;相等则取 `by` 字典序大的
- 删除留墓碑( `deleted: true` ),不清理
- 输出按 `id` 升序排序,保证两台设备合并结果逐字节一致

## 5. Gitee 同步协议

### 5.1 配置
- `repo`: 仓库路径,格式 `owner/repo`
- `branch`: 分支名,默认 `master`
- `token`: Gitee personal access token(需要 `projects` 写权限)

### 5.2 文件路径
```
vault/vault.json
```

### 5.3 读( pull )
```
GET https://gitee.com/api/v5/repos/{owner}/{repo}/contents/vault/vault.json?ref={branch}&access_token={token}
```
返回 `content`( base64 )与 `sha`。

### 5.4 写( push )
```
PUT https://gitee.com/api/v5/repos/{owner}/{repo}/contents/vault/vault.json
```
Body:
```json
{
  "access_token": "...",
  "content": "<base64(合并后的 vault.json)>",
  "sha": "<上一步读到的 sha;新建时省略>",
  "message": "vault: <device-name>",
  "branch": "<branch>"
}
```

### 5.5 冲突处理(乐观并发)
1. pull 拿到远端内容与 `sha`
2. 本地合并
3. push 时带上 `sha`
4. 若 Gitee 返回 409/400( sha 不匹配 ),重新 pull → 合并 → push,最多 3 轮
5. 3 轮仍失败则提示「同步冲突,请稍后再试」

### 5.6 设备标识
`localStorage` 存一个随机 UUID 作为 `by` 字段,首次启动生成,永不变化。

## 6. base-app 桥接

### 6.1 引入方式
从 base-app 的 `hybrid/html/uni.webview.1.5.6.js` 复制到本项目的 `public/bridge/uni.webview.js`,通过 `<script>` 引入。

### 6.2 发送消息(H5 → 原生)
```ts
uni.postMessage({
  data: {
    uuid: 'msg-xxx',
    type: 'getSafeArea',
    params: {}
  }
})
```

### 6.3 接收回复(原生 → H5)
原生端通过 `webview.evalJS` 调用:
```js
window['msg-xxx']({ state: 1, data: ... })
```
H5 在发送时把回调挂到 `window[uuid]`,收到后清理。

### 6.4 已支持的命令
| type | 参数 | 返回 |
|------|------|------|
| `getEnv` | 无 | `'pad'` |
| `getSafeArea` | 无 | `{ top, bottom, left, right }` |
| `setStatusBarColor` | `{ color: string }` | `true` |

### 6.5 环境检测
```ts
const isInApp = typeof uni !== 'undefined' && uni.postMessage
```
不在 App 里时(浏览器开发),安全区回退到 `0`,状态栏颜色静默失败。

## 7. 页面结构

### 7.1 状态机
```
loading → no-key(创建/导入引导)
       → locked(显示指纹,一键解锁)
       → unlocked(卡片墙 + 工具带)
```

### 7.2 卡片墙
- 顶部:搜索框 + 条数统计 + 同步状态 + 设置按钮 + 添加按钮
- 主体:按分组分段,每段标题 + 卡片网格( 240px 自适应 )
- 卡片内容:名字(标题) + 密码行(遮罩/明文 + 复制 + 眼睛) + 更多菜单(编辑/删除)
- 空态:区分「无记录」与「搜索无结果」

### 7.3 弹层
- **添加/编辑弹框**:名字、密码、分组(可筛选可创建)、备注
- **设置弹层**:密钥管理(创建/导入/导出/更换)、同步配置(仓库/分支/token)、外观(主题/状态栏颜色)、关于

## 8. 项目结构

```
workbench-app/
├── src/
│   ├── main.ts
│   ├── App.vue
│   ├── views/
│   │   └── VaultView.vue          # 卡片墙主页面
│   ├── components/
│   │   ├── VaultCard.vue          # 单张卡片
│   │   ├── VaultEntryDialog.vue   # 添加/编辑弹框
│   │   ├── VaultKeyDialog.vue     # 密钥管理
│   │   ├── SettingsPanel.vue      # 设置弹层
│   │   └── AppDialog.vue          # 基础弹框(毛玻璃)
│   ├── stores/
│   │   └── vault.ts               # 保险库状态与动作
│   ├── bridge/
│   │   ├── client.ts              # 桥客户端(发送/接收)
│   │   └── handlers.ts            # getEnv / getSafeArea / setStatusBarColor
│   ├── sync/
│   │   ├── gitee.ts               # Gitee API 读写
│   │   └── merge.ts               # 合并逻辑(与 Workbench 一致)
│   ├── vault/
│   │   ├── crypto.ts              # ECIES 加解密
│   │   ├── file.ts                # vault.json 解析与生成
│   │   └── key.ts                 # 密钥串编解码
│   └── styles/
│       └── main.css               # 毛玻璃主题变量
├── public/
│   └── bridge/
│       └── uni.webview.js         # 从 base-app 复制
├── docs/
│   └── superpowers/
│       └── specs/
│           └── 2026-09-30-password-vault-app-design.md
├── AGENTS.md
├── package.json
├── vite.config.ts
└── tsconfig.json
```

## 9. AGENTS.md 核心约束

1. **不新增编译单元**:不引入 Rust/原生侧加密库,只用 Web Crypto。
2. **数据格式冻结**:任何字段变更必须同时改 Workbench 与本项目,并提升 `VAULT_VERSION`。
3. **合并确定性**:`merge.ts` 必须是纯函数,不允许出现「以本地为准」或「以远端为准」。
4. **密钥不出内存**:私钥只存 `localStorage`(用户已确认),不发送网络、不写日志。
5. **桥命令只增不改**:base-app 已有 `getEnv/getSafeArea/setStatusBarColor`,新增命令需在 base-app 侧同步添加 handler。
6. **UI 一致性**:卡片、弹框、按钮复用现有组件,不另起样式体系。

## 10. 错误处理与边界

| 场景 | 行为 |
|------|------|
| 无密钥 | 引导创建或导入 |
| 密钥导入格式错误 | 提示「这段内容不是一把保险库密钥」 |
| 仓库里无 vault.json | 视为空库,首次 push 时创建 |
| 远端密钥与本机不匹配 | 警告「仓库里那份是用别的密钥加的密」 |
| 单条解密失败 | 计数提示「有 N 条解不开」,其余正常显示 |
| 同步冲突 3 轮未落定 | 提示稍后再试,本地改动已保存 |
| 不在 App 环境(浏览器) | 桥功能静默降级,同步可用 |

## 11. 测试策略

- **单元测试**:`crypto.ts`(加解密往返)、`merge.ts`(合并确定性)、`key.ts`(编解码)
- **集成测试**:Gitee API 用 mock server 或真仓库(需 token)
- **手工验证**:与 Workbench 桌面端互导密钥、互相同步、修改后双向可见
