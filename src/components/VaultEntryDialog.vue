/**
 * 添加 / 编辑一条记录的弹层。
 *
 * **草稿是这一层自己的事**：打开时把那条记录拷进来，改到一半关掉不影响外面那张卡片。
 * 保存本身不在这里做（那是 store 的 `saveEntry`，要落盘、要推同步），
 * 这里只把「用户填成什么样」交给父组件 —— 父组件保存失败时弹层不关，填过的字一个不丢。
 *
 * **分组是自由文本，不是一份要维护的清单**：所以主输入框就是那唯一的事实，
 * 下面那排标签只是「现有分组」的快捷方式。这样既不用单独做「新建 / 改名 / 删除分组」，
 * 也不会出现「标签里有一个、记录里没有」的两份状态。
 */

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import AppSheet from '@/components/ui/AppSheet.vue'
import AppField from '@/components/ui/AppField.vue'
import { emptyVaultEntry, vaultEntryProblem, type VaultEntry, type VaultRecord } from '@/vault/file'

const visible = defineModel<boolean>('visible', { required: true })

const props = defineProps<{
  /** 要编辑的那条；null 表示新增 */
  record: VaultRecord | null
  /** 现存的全部组名，作为快捷标签 */
  groups: string[]
  /** 父组件正在保存：这期间不许关弹层，也不许再点一次保存 */
  saving: boolean
}>()

const emit = defineEmits<{ save: [entry: VaultEntry] }>()

const draft = ref<VaultEntry>(emptyVaultEntry())
/** 名字那一栏的红字。**只在点过保存之后才出现** —— 一打开就红着脸说「请填一个名字」很唐突 */
const problem = ref('')
const nameField = ref<InstanceType<typeof AppField> | null>(null)

const title = computed(() => (props.record ? '编辑记录' : '添加记录'))

watch(visible, (open) => {
  if (!open) return

  const record = props.record
  draft.value = record
    ? { name: record.name, password: record.password, notes: record.notes, group: record.group }
    : emptyVaultEntry()
  problem.value = ''

  // 等抽屉进场之后再聚焦：进场那一帧还在动，这时弹键盘会让它跳一下
  void nextTick(() => nameField.value?.focus())
})

function pickGroup(name: string): void {
  draft.value.group = name
}

function submit(): void {
  const bad = vaultEntryProblem(draft.value)
  problem.value = bad ?? ''
  if (bad) {
    nameField.value?.focus()
    return
  }
  emit('save', { ...draft.value })
}
</script>

<template>
  <AppSheet
    v-model:visible="visible"
    :title="title"
    :dismissible="!saving"
    description="名字是必填的，其余想记多少记多少"
  >
    <div class="form">
      <AppField
        ref="nameField"
        v-model="draft.name"
        label="名字"
        placeholder="比如：家里路由器"
        :error="problem"
        @enter="submit"
      />

      <AppField
        v-model="draft.password"
        type="password"
        mono
        label="密码"
        placeholder="要记住的那一串"
      />

      <div class="form__group">
        <AppField v-model="draft.group" label="分组" placeholder="留空就是未分组" />
        <div class="chips">
          <button
            type="button"
            class="chip"
            :class="{ 'is-active': !draft.group }"
            @click="pickGroup('')"
          >
            不分组
          </button>
          <button
            v-for="name in groups"
            :key="name"
            type="button"
            class="chip"
            :class="{ 'is-active': draft.group === name }"
            @click="pickGroup(name)"
          >
            {{ name }}
          </button>
        </div>
      </div>

      <AppField
        v-model="draft.notes"
        type="textarea"
        label="备注"
        placeholder="备用码放在哪、绑的是哪个邮箱…"
        :rows="3"
      />
    </div>

    <template #footer>
      <button type="button" class="btn" :disabled="saving" @click="visible = false">取消</button>
      <button type="button" class="btn btn--primary" :disabled="saving" @click="submit">
        {{ saving ? '保存中…' : '保存' }}
      </button>
    </template>
  </AppSheet>
</template>

<style scoped>
.form {
  display: flex;
  flex-direction: column;
  gap: var(--sp-4);
}

/* 分组这一栏比别的多一行标签，缩紧一点，看着仍是一栏 */
.form__group {
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
}
</style>