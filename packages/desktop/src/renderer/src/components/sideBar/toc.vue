<template>
  <div
    class="side-bar-toc"
    :class="[{ 'side-bar-toc-overflow': !wordWrapInToc, 'side-bar-toc-wordwrap': wordWrapInToc }]"
  >
    <div class="title">
      {{ t('sideBar.toc.title') }}
    </div>
    <el-tree
      v-if="toc.length"
      :data="toc"
      :default-expand-all="true"
      :props="defaultProps"
      :expand-on-click-node="false"
      :indent="10"
      :icon="ArrowRight"
      @node-click="handleClick"
      @node-contextmenu="handleContextMenu"
    />
  </div>
</template>

<script setup lang="ts">
import { useEditorStore } from '@/store/editor'
import { usePreferencesStore } from '@/store/preferences'
import bus from '../../bus'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { ArrowRight } from '@element-plus/icons-vue'
import { popupContextMenu } from '../../contextMenu/popupMenu'
import notice from '../../services/notification'

const { t } = useI18n()

const editorStore = useEditorStore()
const preferencesStore = usePreferencesStore()

const defaultProps = {
  children: 'children',
  label: 'label'
}

const { toc } = storeToRefs(editorStore)
const { wordWrapInToc } = storeToRefs(preferencesStore)

const handleClick = (data: { slug?: unknown }): void => {
  if (typeof data.slug !== 'string' || data.slug.length === 0) return
  bus.emit('scroll-to-header', data.slug)
}

const extractSectionMarkdown = (targetLvl: number, targetLabel: string): string | null => {
  const markdown = editorStore.currentFile?.markdown
  if (!markdown) return null

  const lines = markdown.split('\n')
  const headingRegex = /^(#{1,6})\s+(.*)$/

  let startLine = -1
  let endLine = lines.length

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(headingRegex)
    if (!match) continue
    const lvl = match[1].length
    const rawText = match[2].trim()
    const stripped = rawText.replace(/[*_`~[\]()#]/g, '').trim()

    if (startLine === -1) {
      if (lvl === targetLvl && (rawText === targetLabel || stripped === targetLabel || rawText.includes(targetLabel))) {
        startLine = i
      }
    } else {
      if (lvl <= targetLvl) {
        endLine = i
        break
      }
    }
  }

  if (startLine === -1) return null
  return lines.slice(startLine, endLine).join('\n').trimEnd()
}

const handleContextMenu = (event: MouseEvent, data: { lvl?: number | null; slug?: unknown; label?: unknown }): void => {
  event.preventDefault()
  if (data.lvl == null) return

  const label = typeof data.label === 'string' ? data.label : ''
  if (!label) return

  const items = [
    {
      label: t('contextMenu.toc.copySectionContent'),
      id: 'copySectionContentMenuItem',
      click () {
        const content = extractSectionMarkdown(data.lvl!, label)
        if (content) {
          window.electron.clipboard.writeText(content)
          notice.notify({
            title: t('contextMenu.toc.copySectionContent'),
            type: 'primary',
            message: t('contextMenu.toc.copySuccess')
          })
        } else {
          notice.notify({
            title: t('contextMenu.toc.copySectionContent'),
            type: 'warning',
            message: t('contextMenu.toc.copyEmpty')
          })
        }
      }
    }
  ]

  popupContextMenu(items, { x: event.clientX, y: event.clientY })
}
</script>

<style>
.side-bar-toc {
  height: calc(100% - 35px);
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
}

.side-bar-toc .title {
  color: var(--sideBarTitleColor);
  font-weight: 600;
  font-size: 16px;
  margin: 37px 0 10px 0;
  padding-left: 25px;
}

.side-bar-toc .el-tree-node {
  margin-top: 8px;
}

.side-bar-toc .el-tree {
  background: transparent;
  color: var(--sideBarColor);
}

.side-bar-toc .el-tree-node:focus > .el-tree-node__content {
  background-color: var(--sideBarItemHoverBgColor);
}

.side-bar-toc .el-tree-node__content:hover {
  background: var(--sideBarItemHoverBgColor);
}

.side-bar-toc > li {
  font-size: 14px;
  margin-bottom: 15px;
  cursor: pointer;
}
.side-bar-toc-overflow {
  overflow: auto;
}
.side-bar-toc-wordwrap {
  overflow-x: hidden;
  overflow-y: auto;
}

.side-bar-toc-wordwrap .el-tree-node__content {
  white-space: normal;
  height: auto;
  min-height: 26px;
}
</style>
