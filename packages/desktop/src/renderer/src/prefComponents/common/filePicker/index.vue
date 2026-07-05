<template>
  <section class="pref-file-picker-item">
    <div class="description">
      <span>{{ description }}:</span>
    </div>
    <div class="picker-row">
      <el-input
        v-model="inputText"
        class="input"
        :placeholder="placeholder"
        size="small"
        clearable
        @input="handleInput"
      />
      <el-button
        size="small"
        @click="handleBrowse"
      >
        {{ t('preferences.markdown.diagrams.browse') }}
      </el-button>
    </div>
  </section>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

interface FilePickerProps {
  description: string
  input: string
  onChange: (value: string) => void
  onBrowse: () => Promise<string>
  placeholder?: string
  emitTime?: number
}

const props = withDefaults(defineProps<FilePickerProps>(), {
  placeholder: '',
  emitTime: 800
})

const { t } = useI18n()
const inputText = ref(props.input)
let inputTimer: ReturnType<typeof setTimeout> | null = null

watch(
  () => props.input,
  (value, oldValue) => {
    if (value !== oldValue) {
      inputText.value = value
    }
  }
)

const handleInput = (value: string) => {
  if (inputTimer) {
    clearTimeout(inputTimer)
  }
  inputTimer = setTimeout(() => {
    inputTimer = null
    props.onChange(value)
  }, props.emitTime)
}

const handleBrowse = async () => {
  try {
    const selected = await props.onBrowse()
    if (selected) {
      if (inputTimer) {
        clearTimeout(inputTimer)
        inputTimer = null
      }
      inputText.value = selected
      props.onChange(selected)
    }
  } catch (err) {
    console.error('[FilePicker] browse failed:', err)
  }
}
</script>

<style>
.pref-file-picker-item {
  font-size: 14px;
  user-select: none;
  margin: 12px 0;
  color: var(--editorColor);
  width: 100%;
  & .description {
    margin-bottom: 10px;
    background: transparent;
    color: var(--editorColor);
  }
  & .picker-row {
    display: flex;
    gap: 8px;
    align-items: center;
  }
  & .input {
    flex: 1;
  }
  & input.el-input__inner {
    height: 30px;
    background: transparent;
    border: none;
    padding-right: 15px;
    &::placeholder {
      color: var(--editorColor30);
    }
  }
  & .el-input.is-active .el-input__inner,
  & .el-input__inner:focus {
    border-color: var(--themeColor);
  }
  & .el-input__icon,
  & .el-input__inner {
    line-height: 30px;
  }
  & div {
    background: transparent;
    color: var(--editorColor);
    border-color: var(--editorColor10);
  }
}
</style>
