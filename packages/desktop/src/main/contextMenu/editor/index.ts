import {
  Menu,
  MenuItem,
  clipboard,
  nativeImage,
  type BrowserWindow,
  type MenuItemConstructorOptions
} from 'electron'
import {
  getCUT,
  getCOPY,
  getPASTE,
  getCopyAsRich,
  getCopyAsHtml,
  getPasteAsPlainText,
  SEPARATOR,
  getInsertBefore,
  getInsertAfter
} from './menuItems'
import spellcheckMenuBuilder from './spellcheck'
import { t } from '../../i18n'

// Electron's ContextMenuParams shape we rely on. Kept narrow — the renderer
// supplies the full surface so we only annotate the fields we use.
interface ContextMenuParams {
  isEditable: boolean
  hasImageContents?: boolean
  selectionText: string
  inputFieldType?: string
  editFlags: {
    canCut: boolean
    canCopy: boolean
    canPaste: boolean
    canEditRichly: boolean
  }
  misspelledWord?: string
  dictionarySuggestions?: string[]
  // Coordinates of the context-menu request. Electron names them `x`/`y` on
  // the params (not the event); the renderer passes them through unchanged.
  x: number
  y: number
}

// Electron `webContents.on('context-menu', (event, params) => ...)` provides
// a simple event object with preventDefault — nothing on it is consumed by
// this function, so we keep the type minimal.
type ContextMenuEvent = {
  preventDefault?: () => void
  readonly defaultPrevented?: boolean
}

// Dynamically fetch menu items to ensure correct translation
const getContextItems = (): MenuItemConstructorOptions[] => [
  getInsertBefore(),
  getInsertAfter(),
  SEPARATOR,
  getCUT(),
  getCOPY(),
  getPASTE(),
  SEPARATOR,
  getCopyAsRich(),
  getCopyAsHtml(),
  getPasteAsPlainText()
]

const isInsideEditor = (params: ContextMenuParams): boolean => {
  const { isEditable, editFlags, inputFieldType } = params
  // WORKAROUND for Electron#32102: `params.spellcheckEnabled` is always false. Try to detect the editor container via other information.
  return isEditable && !inputFieldType && !!editFlags.canEditRichly
}

function buildDetectDiagramScript(x: number, y: number): string {
  return `(function() {
    var el = document.elementFromPoint(${x}, ${y});
    while (el) {
      if (el.classList && el.classList.contains('mu-diagram-preview')) return true;
      el = el.parentElement;
    }
    return false;
  })()`
}

function buildCopyCodeScript(x: number, y: number): string {
  return `(function() {
    var el = document.elementFromPoint(${x}, ${y});
    while (el && !(el.classList && el.classList.contains('mu-diagram-preview'))) el = el.parentElement;
    if (!el) return null;
    var figure = el.closest('figure.mu-diagram-block');
    if (!figure) return null;
    var code = figure.querySelector('.mu-codeblock-content');
    return code ? code.textContent : null;
  })()`
}

function buildCopySvgScript(x: number, y: number): string {
  return `(function() {
    var el = document.elementFromPoint(${x}, ${y});
    while (el && !(el.classList && el.classList.contains('mu-diagram-preview'))) el = el.parentElement;
    if (!el) return null;
    var svg = el.querySelector('svg');
    if (!svg) return null;
    var clone = svg.cloneNode(true);
    if (!clone.getAttribute('xmlns')) clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    var rect = svg.getBoundingClientRect();
    var w = rect.width || 300;
    var h = rect.height || 150;
    var data = new XMLSerializer().serializeToString(clone);
    var blob = new Blob([data], {type: 'image/svg+xml;charset=utf-8'});
    var url = URL.createObjectURL(blob);
    return new Promise(function(resolve) {
      var img = new Image();
      img.onload = function() {
        var canvas = document.createElement('canvas');
        var dpr = window.devicePixelRatio || 1;
        canvas.width = w * dpr;
        canvas.height = h * dpr;
        var ctx = canvas.getContext('2d');
        if (!ctx) { URL.revokeObjectURL(url); resolve(null); return; }
        ctx.scale(dpr, dpr);
        ctx.drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL('image/png'));
      };
      img.onerror = function() { URL.revokeObjectURL(url); resolve(null); };
      img.src = url;
    });
  })()`
}

function showDiagramMenu(
  win: BrowserWindow,
  params: ContextMenuParams,
  copyImageAction: () => void
): void {
  const copyCodeScript = buildCopyCodeScript(params.x, params.y)
  const menu = new Menu()
  menu.append(
    new MenuItem({
      label: t('contextMenu.copyImage'),
      click: copyImageAction
    })
  )
  menu.append(
    new MenuItem({
      label: t('contextMenu.copyCode'),
      click() {
        if (win.isDestroyed()) return
        win.webContents
          .executeJavaScript(copyCodeScript)
          .then((code: string | null) => {
            if (code) clipboard.writeText(code)
          })
          .catch(() => {})
      }
    })
  )
  menu.popup({ window: win, x: params.x, y: params.y })
}

export const showEditorContextMenu = (
  win: BrowserWindow,
  event: ContextMenuEvent,
  params: ContextMenuParams,
  isSpellcheckerEnabled: boolean
): void => {
  const {
    isEditable,
    hasImageContents,
    selectionText,
    editFlags,
    misspelledWord,
    dictionarySuggestions
  } = params

  // NOTE: We have to get the word suggestions from this event because `webFrame.getWordSuggestions` and
  //       `webFrame.isWordMisspelled` doesn't work on Windows (Electron#28684).

  // PlantUML renders as <img> (hasImageContents=true). Detect whether the
  // image is inside a diagram block before showing the diagram menu —
  // regular inline images should not get a "Copy Code" item.
  if (hasImageContents) {
    const detectScript = buildDetectDiagramScript(params.x, params.y)
    win.webContents.executeJavaScript(detectScript).then((isDiagram: boolean) => {
      if (win.isDestroyed()) return
      if (!isDiagram) {
        // Regular image — show only "Copy Image"
        const menu = new Menu()
        menu.append(
          new MenuItem({
            label: t('contextMenu.copyImage'),
            click() {
              win.webContents.copyImageAt(params.x, params.y)
            }
          })
        )
        menu.popup({ window: win, x: params.x, y: params.y })
        return
      }
      showDiagramMenu(win, params, () => {
        win.webContents.copyImageAt(params.x, params.y)
      })
    }).catch(() => {})
    return
  }

  // Mermaid/flowchart/sequence render inline SVG inside a
  // contenteditable="false" container, so isEditable is false and
  // hasImageContents is false.
  if (!isInsideEditor(params)) {
    const detectScript = buildDetectDiagramScript(params.x, params.y)
    win.webContents.executeJavaScript(detectScript).then((isDiagram: boolean) => {
      if (win.isDestroyed()) return
      if (!isDiagram) return

      const copySvgScript = buildCopySvgScript(params.x, params.y)
      showDiagramMenu(win, params, () => {
        if (win.isDestroyed()) return
        win.webContents
          .executeJavaScript(copySvgScript)
          .then((dataURL: string | null) => {
            if (dataURL) {
              const img = nativeImage.createFromDataURL(dataURL)
              clipboard.writeImage(img)
            }
          })
          .catch(() => {})
      })
    }).catch(() => {})
    return
  }

  const hasText = selectionText.trim().length > 0
  const canCopy = hasText && editFlags.canCut && editFlags.canCopy
  const isMisspelled = isEditable && !!selectionText && !!misspelledWord

  const menu = new Menu()
  if (isSpellcheckerEnabled) {
    const spellingSubmenu = spellcheckMenuBuilder(
      isMisspelled,
      misspelledWord,
      dictionarySuggestions
    )
    menu.append(
      new MenuItem({
        label: t('contextMenu.spelling'),
        submenu: spellingSubmenu as Electron.MenuItemConstructorOptions[]
      })
    )
    menu.append(new MenuItem(SEPARATOR))
  }

  const contextItems = getContextItems()
  const copyItems = [contextItems[3], contextItems[4], contextItems[8], contextItems[7]] // CUT, COPY, COPY_AS_HTML, COPY_AS_RICH
  copyItems.forEach((item) => {
    if (item) item.enabled = canCopy
  })
  contextItems.forEach((item) => {
    menu.append(new MenuItem(item))
  })
  // eslint-disable-next-line @typescript-eslint/no-unused-expressions
  event
  menu.popup({ window: win, x: params.x, y: params.y })
}
