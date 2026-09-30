/**
 * 一个带标签的输入栏。四种形态收在一个组件里：普通文本、密码、多行、可切换明文的密码。
 *
 * **为什么合成一个**：名字 / 密码 / 备注 / 令牌这四栏在结构上只差「有没有标签、是不是多行、
 * 要不要那颗眼睛」。拆成四个组件的话，标签的字号、聚焦时的边、错误提示的位置
 * 会在四处各写一遍 —— 那正是「同一个页面里三个输入框三种样子」的来路。
 *
 * 输入框自身不带边框，边框在 `.field__box` 上（见 `main.css` 的说明）。
 */

<script setup lang="ts">
import { computed, ref } from 'vue'

const model = defineModel<string>({ required: true })

const props = withDefaults(
  defineProps<{
    label?: string
    placeholder?: string
    /** `textarea` 是多行；`password` 会带上那颗显示 / 隐藏的眼睛 */
    type?: 'text' | 'password' | 'textarea' | 'url'
    /** 等宽字体。密码与令牌这类要逐字符核对的内容用它 */
    mono?: boolean
    error?: string
    hint?: string
    rows?: number
    /** 打开弹层时自动聚焦（由父组件在 opened 之后调 `focus()`） */
    spellcheck?: boolean
  }>(),
  { label: '', placeholder: '', type: 'text', mono: false, error: '', hint: '', rows: 3, spellcheck: false }
)

const emit = defineEmits<{ enter: [] }>()

const inputRef = ref<HTMLInputElement | HTMLTextAreaElement>()

/** 密码默认遮住。**这是「别把密码摊在屏幕上」这条的落点**，不是多余的一步操作 */
const revealed = ref(false)

const isTextarea = computed(() => props.type === 'textarea')
const isPassword = computed(() => props.type === 'password')
/** 真正的 input type：密码栏在「亮着」的时候就是普通文本 */
const inputType = computed(() => {
  if (isTextarea.value) return undefined
  if (isPassword.value) return revealed.value ? 'text' : 'password'
  return props.type
})

function focus(): void {
  inputRef.value?.focus()
}

defineExpose({ focus })
</script>

<template>
  <label class="field">
    <span v-if="label" class="field__label">{{ label }}</span>

    <span class="field__box" :class="{ 'is-invalid': Boolean(error) }">
      <textarea
        v-if="isTextarea"
        ref="inputRef"
        v-model="model"
        class="field__input"
        :class="{ 'field__input--mono': mono }"
        :placeholder="placeholder"
        :rows="rows"
        :spellcheck="spellcheck"
      />
      <input
        v-else
        ref="inputRef"
        v-model="model"
        class="field__input"
        :class="{ 'field__input--mono': mono }"
        :type="inputType"
        :placeholder="placeholder"
        :spellcheck="spellcheck"
        autocapitalize="off"
        autocomplete="off"
        autocorrect="off"
        @keyup.enter="emit('enter')"
      />

      <!--
        密码栏的那颗眼睛。**它是「查看」而不是「编辑」**，所以放在输入框内侧右缘，
        与内容同一条中线；这也是用户在这类界面上找它的地方。
      -->
      <button
        v-if="isPassword"
        type="button"
        class="field__peek"
        :aria-label="revealed ? '隐藏' : '显示'"
        @click.prevent="revealed = !revealed"
      >
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <template v-if="revealed">
            <path
              d="M3 12s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6z"
              fill="none"
              stroke="currentColor"
              stroke-width="1.6"
            />
            <circle cx="12" cy="12" r="2.6" fill="none" stroke="currentColor" stroke-width="1.6" />
          </template>
          <template v-else>
            <path
              d="M4 4l16 16M6.5 6.9C4.4 8.4 3 12 3 12s3.5 6 9 6c1.6 0 3-.4 4.2-1.1M17.6 17c1.9-1.5 3.4-5 3.4-5s-3.5-6-9-6c-.9 0-1.7.1-2.4.4"
              fill="none"
              stroke="currentColor"
              stroke-width="1.6"
              stroke-linecap="round"
            />
          </template>
        </svg>
      </button>
    </span>

    <p v-if="error" class="field__error">{{ error }}</p>
    <p v-else-if="hint" class="field__hint">{{ hint }}</p>
  </label>
</template>

<style scoped>
.field__peek {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  margin-right: -4px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--ink-3);
  cursor: pointer;
  transition: color 0.16s ease;
}

.field__peek:active {
  color: var(--ink);
}
</style>