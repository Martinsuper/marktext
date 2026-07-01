import { ipcMain, dialog, BrowserWindow } from 'electron'
import { spawn } from 'node:child_process'
import os from 'node:os'
import log from 'electron-log'

const MAX_CONCURRENT = Math.max(2, Math.min(os.cpus().length - 1, 4))
let running = 0
const queue: Array<{ resolve: (v: { svg: string } | { error: string }) => void; req: RenderRequest }> = []

interface RenderRequest {
  code: string
  jarPath: string
  javaPath: string
}

function spawnRender(req: RenderRequest): Promise<{ svg: string } | { error: string }> {
  const { code, jarPath, javaPath } = req

  return new Promise((resolve) => {
    let resolved = false
    const done = (result: { svg: string } | { error: string }) => {
      if (!resolved) {
        resolved = true
        running--
        resolve(result)
        drainQueue()
      }
    }

    running++
    const child = spawn(javaPath || 'java', ['-jar', jarPath, '-tsvg', '-charset', 'UTF-8', '-pipe'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 30000
    })

    const stdoutChunks: Buffer[] = []
    const stderrChunks: Buffer[] = []

    child.stdout.on('data', (chunk: Buffer) => {
      stdoutChunks.push(chunk)
    })

    child.stderr.on('data', (chunk: Buffer) => {
      stderrChunks.push(chunk)
    })

    child.on('error', (err) => {
      log.error('PlantUML local render spawn error:', err)
      done({ error: `Failed to start Java process: ${err.message}` })
    })

    child.on('close', (exitCode) => {
      if (exitCode === 0) {
        done({ svg: Buffer.concat(stdoutChunks).toString('utf-8') })
      } else {
        const stderr = Buffer.concat(stderrChunks).toString('utf-8')
        done({ error: stderr || `Process exited with code ${exitCode}` })
      }
    })

    child.stdin.on('error', () => {
      // EPIPE is expected if the child exits before stdin is fully written.
    })

    child.stdin.write(code, 'utf-8')
    child.stdin.end()
  })
}

function drainQueue() {
  while (queue.length > 0 && running < MAX_CONCURRENT) {
    const item = queue.shift()!
    spawnRender(item.req).then(item.resolve)
  }
}

function renderPlantumlLocal(
  req: RenderRequest
): Promise<{ svg: string } | { error: string }> {
  if (!req.jarPath) {
    return Promise.resolve({ error: 'plantuml.jar path is not configured' })
  }

  if (running < MAX_CONCURRENT) {
    return spawnRender(req)
  }

  return new Promise((resolve) => {
    queue.push({ resolve, req })
  })
}

export const registerPlantumlHandlers = (): void => {
  ipcMain.handle(
    'mt::plantuml::render-local',
    (_e, req: RenderRequest) => renderPlantumlLocal(req)
  )

  ipcMain.handle(
    'mt::plantuml::select-jar',
    async (e) => {
      const win = BrowserWindow.fromWebContents(e.sender)
      if (!win) return ''
      const { filePaths } = await dialog.showOpenDialog(win, {
        properties: ['openFile'],
        filters: [{ name: 'JAR Files', extensions: ['jar'] }]
      })
      return filePaths?.[0] ?? ''
    }
  )

  ipcMain.handle(
    'mt::plantuml::select-java',
    async (e) => {
      const win = BrowserWindow.fromWebContents(e.sender)
      if (!win) return ''
      const { filePaths } = await dialog.showOpenDialog(win, {
        properties: ['openFile']
      })
      return filePaths?.[0] ?? ''
    }
  )
}
