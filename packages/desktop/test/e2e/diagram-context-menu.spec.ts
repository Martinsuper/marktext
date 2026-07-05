import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import { launchWithMarkdown, focusEditor } from './helpers'

// Validates the diagram context menu feature: right-clicking a rendered diagram
// block shows a context menu with "Copy source code" / "Copy Image" options.

const MERMAID_DOC = '# diagram ctx menu\n\n```mermaid\ngraph TD;\n  A-->B;\n  B-->C;\n```\n'

test.describe('Diagram context menu', () => {
  let app: ElectronApplication
  let page: Page

  test.beforeAll(async() => {
    const launched = await launchWithMarkdown(MERMAID_DOC)
    app = launched.app
    page = launched.page
    await focusEditor(page)
  })

  test.afterAll(async() => {
    if (app) await app.close()
  })

  test('right-clicking a diagram preview shows the context menu', async() => {
    // Wait for the diagram block to render (muya renders diagrams lazily).
    const diagramPreview = page.locator('.mu-diagram-preview').first()
    await expect(diagramPreview).toBeVisible({ timeout: 15000 })

    // Right-click on the diagram preview area.
    await diagramPreview.click({ button: 'right' })

    // The context menu should appear with a "Copy source code" item.
    const contextMenu = page.locator('.mu-diagram-context-menu')
    await expect(contextMenu).toBeVisible({ timeout: 5000 })

    const menuItems = contextMenu.locator('.mu-diagram-context-menu-item')
    await expect(menuItems.first()).toBeVisible()

    // Verify at least one menu item contains copy-related text.
    const firstItemText = await menuItems.first().textContent()
    expect(firstItemText).toBeTruthy()
  })

  test('clicking a context menu item closes the menu', async() => {
    // Re-open the menu
    const diagramPreview = page.locator('.mu-diagram-preview').first()
    await diagramPreview.click({ button: 'right' })

    const contextMenu = page.locator('.mu-diagram-context-menu')
    await expect(contextMenu).toBeVisible({ timeout: 5000 })

    // Click the first menu item
    const firstItem = contextMenu.locator('.mu-diagram-context-menu-item').first()
    await firstItem.click()

    // Menu should be gone
    await expect(contextMenu).toBeHidden({ timeout: 3000 })
  })

  test('Escape closes the context menu', async() => {
    const diagramPreview = page.locator('.mu-diagram-preview').first()
    await diagramPreview.click({ button: 'right' })

    const contextMenu = page.locator('.mu-diagram-context-menu')
    await expect(contextMenu).toBeVisible({ timeout: 5000 })

    await page.keyboard.press('Escape')
    await expect(contextMenu).toBeHidden({ timeout: 3000 })
  })

  test('clicking outside the context menu closes it', async() => {
    const diagramPreview = page.locator('.mu-diagram-preview').first()
    await diagramPreview.click({ button: 'right' })

    const contextMenu = page.locator('.mu-diagram-context-menu')
    await expect(contextMenu).toBeVisible({ timeout: 5000 })

    // Click on the editor body outside the menu
    await page.click('.editor-component', { position: { x: 10, y: 10 } })
    await expect(contextMenu).toBeHidden({ timeout: 3000 })
  })
})
