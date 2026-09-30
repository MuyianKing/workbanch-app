/**
 * 密钥管理弹层：创建 / 导入 / 导出 / 忘记，以及那句「两边的公钥对不对得上」。
 *
 * **为什么导出是一段可以复制的串而不是一个文件**：壳里没有文件系统，也没有「另存为」的对话框。
 * 桌面端那边导出成文件是因为有文件系统可用；这里只能把密钥串摊出来让用户自己复制走
 * （粘到另一台设备的「导入」里，或者存进自己的笔记）。
 *
 * 三件必须说清楚的事，界面上都写着：
 *  - 这串东西就是私钥 —— 谁拿到它就能解开这个保险库；
 *  - 换密钥等于把用旧密钥加密的条目作废（本机那些还能读出来的会自动改成新密钥，读不出来的就没了）；
 *  - 两台设备对不对得上，看指纹，不看密钥本身。
 */

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import AppSheet from '@/components/ui/AppSheet.vue'
import AppField from '@/components/ui/AppField.vue'
import { copyText } from '@/clipboard'
import { notifyFailure, notifySuccess } from '@/toast'

const visible = defineModel<boolean>('visible', { required: true })

const props = defineProps<{
  keyExists: boolean
  unlocked: boolean
  /** 公钥指纹（`A1B2-C3D4-E5F6`）。锁着也算得出来，这一屏主要就是拿它核对 */
  fingerprint: string
  /** 父组件正在忙（创建 / 导入中） */
  busy: boolean
  /** 导出的密钥串。**没解锁时是 null** —— 私钥在内存里，锁上了就取不出来 */
  keyString: string | null
}>()

const emit = defineEmits<{
  create: [replace: boolean]
  import: [text: string]
  forget: []
}>()

/** `menu` 是那张动作清单，`import` 是粘贴密钥的那一屏 */
const mode = ref<'menu' | 'import'>('menu')
const importText = ref('')
/** 导出：点一下才把密钥串摊出来，免得每次开这一屏都把它晒在那儿 */
const revealed = ref(false)
/** 忘记密钥的二次确认 —— 这一步一旦点下去，本机就真的没有了 */
const confirmForget = ref(false)

/** 已有密钥时，下面那些动作是「换一把」「导出」「忘掉」，都不是从零开始 */
const canExport = computed(() => props.unlocked && Boolean(props.keyString))

watch(visible, (open) => {
  if (!open) return
  mode.value = 'menu'
  importText.value = ''
  revealed.value = false
  confirmForget.value = false
})

function startImport(): void {
  mode.value = 'import'
  importText.value = ''
}

function confirmImport(): void {
  if (!importText.value.trim()) return
  emit('import', importText.value.trim())
}

async function copyKey(): Promise<void> {
  if (!props.keyString) return
  const done = await copyText(props.keyString)
  if (done) notifySuccess('密钥已复制')
  else notifyFailure('复制密钥', '这台设备不让读剪贴板，请长按下面的内容手动选中复制')
}
</script>

<template>
  <AppSheet
    v-model:visible="visible"
    :title="mode === 'import' ? '导入密钥' : '保险库密钥'"
    :dismissible="!busy"
    tall
    :description="
      mode === 'import'
        ? '把另一台设备导出的密钥串粘进来'
        : '加解密都在这台设备上做，密钥不经过网络'
    "
  >
    <!-- ---------- 指纹 ---------- -->
    <section v-if="mode === 'menu'" class="finger">
      <div class="finger__row">
        <span class="finger__label">公钥指纹</span>
        <span class="finger__value mono">{{ fingerprint || '—' }}</span>
      </div>
      <p class="finger__hint">
        在两台设备上对一下这六个字节。一致才说明两边拿的是同一把密钥，不然同步回来的记录一条也解不开。
      </p>
    </section>

    <!-- ---------- 粘贴密钥 ---------- -->
    <div v-if="mode === 'import'" class="stack">
      <AppField
        v-model="importText"
        type="textarea"
        mono
        label="密钥串"
        placeholder="workbench-vault-v1.…"
        :rows="4"
      />
      <p class="warn">
        这段内容里含私钥，谁拿到它谁就能解开这个保险库 —— 别发到聊天里、别存在云端笔记里。
      </p>
      <p class="warn" v-if="keyExists">
        导入会换掉本机的密钥。原来那些用旧密钥加的记录如果能解开，会自动改成新密钥；解不开的会按删除处理。
      </p>
    </div>

    <!-- ---------- 动作清单 ---------- -->
    <div v-else class="stack">
      <!-- 还没有密钥：从零建一把，或者导入别处的 -->
      <template v-if="!keyExists">
        <p class="lead">这台设备上还没有保险库密钥。</p>
        <button type="button" class="btn btn--primary btn--block" :disabled="busy" @click="emit('create', false)">
          {{ busy ? '正在生成…' : '创建一把新密钥' }}
        </button>
        <button type="button" class="btn btn--block" :disabled="busy" @click="startImport">
          导入已有密钥
        </button>
      </template>

      <!-- 已经有密钥：导出 / 换一把 / 忘记 -->
      <template v-else>
        <button
          v-if="!revealed"
          type="button"
          class="btn btn--block"
          :disabled="!canExport"
          @click="revealed = true"
        >
          导出密钥串
        </button>

        <template v-else>
          <AppField
            :model-value="keyString ?? ''"
            type="textarea"
            mono
            label="密钥串（长按可选中）"
            :rows="4"
          />
          <button type="button" class="btn btn--block" @click="copyKey">复制密钥串</button>
          <p class="warn">这串东西就是私钥本身，复制之后请立刻粘到该去的地方，别留在剪贴板里。</p>
        </template>

        <button type="button" class="btn btn--block" :disabled="busy" @click="startImport">
          导入别的密钥（换一把）
        </button>

        <template v-if="confirmForget">
          <p class="warn">
            清除之后，这台设备上就解不开任何记录了（仓库里那份数据不动，别的设备照旧能用）。
            只要手上还有导出的密钥串，随时可以再导入回来。
          </p>
          <div class="stack__row">
            <button type="button" class="btn" :disabled="busy" @click="confirmForget = false">再想想</button>
            <button type="button" class="btn btn--danger" :disabled="busy" @click="emit('forget')">
              确认清除
            </button>
          </div>
        </template>
        <button v-else type="button" class="btn btn--danger btn--block" :disabled="busy" @click="confirmForget = true">
          忘记本机密钥
        </button>
      </template>
    </div>

    <template v-if="mode === 'import'" #footer>
      <button type="button" class="btn" :disabled="busy" @click="mode = 'menu'">返回</button>
      <button
        type="button"
        class="btn btn--primary"
        :disabled="busy || !importText.trim()"
        @click="confirmImport"
      >
        {{ busy ? '导入中…' : '导入' }}
      </button>
    </template>
  </AppSheet>
</template>

<style scoped>
.finger {
  margin-bottom: var(--sp-5);
  padding: var(--sp-3) var(--sp-4);
  border-radius: var(--r-md);
  background: var(--glass-soft);
  box-shadow: 0 0 0 1px var(--line) inset;
}

.finger__row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--sp-3);
}

.finger__label {
  color: var(--ink-3);
  font-size: var(--fs-meta);
}

.finger__value {
  color: var(--ink);
  font-size: var(--fs-body);
  letter-spacing: 0.04em;
}

.finger__hint {
  margin: var(--sp-2) 0 0;
  color: var(--ink-3);
  font-size: var(--fs-micro);
  line-height: 1.6;
}

.stack {
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
}

.stack__row {
  display: flex;
  gap: var(--sp-3);
}

.stack__row .btn {
  flex: 1 1 0;
}

.lead {
  margin: 0;
  color: var(--ink-2);
  font-size: var(--fs-body);
}

/* 警告一律**不红**：这几句是「请留意」，不是「出错了」。红字留给真正失败的那些消息 */
.warn {
  margin: 0;
  color: var(--warn);
  font-size: var(--fs-micro);
  line-height: 1.7;
}

.warn + .warn {
  margin-top: calc(-1 * var(--sp-1));
}
</style>