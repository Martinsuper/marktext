import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// We test the module logic (queue, concurrency, error handling) in isolation
// by mocking Electron IPC and child_process.

const mockIpcMainHandle = vi.fn()
const mockDialogShowOpenDialog = vi.fn()
const mockBrowserWindowFromWebContents = vi.fn()
const mockSpawn = vi.fn()

vi.mock('electron', () => ({
  ipcMain: { handle: (...args: unknown[]) => mockIpcMainHandle(...args) },
  dialog: { showOpenDialog: (...args: unknown[]) => mockDialogShowOpenDialog(...args) },
  BrowserWindow: { fromWebContents: (...args: unknown[]) => mockBrowserWindowFromWebContents(...args) },
}))

vi.mock('node:child_process', () => ({
  default: { spawn: (...args: unknown[]) => mockSpawn(...args) },
  spawn: (...args: unknown[]) => mockSpawn(...args),
}))

vi.mock('node:os', () => ({
  default: { cpus: () => new Array(4).fill({}) },
  cpus: () => new Array(4).fill({}),
}))

vi.mock('electron-log', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}))

vi.mock('electron-log', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}))

import { EventEmitter } from 'node:events'
import { Readable, Writable } from 'node:stream'

function createMockProcess(exitCode = 0, stdout = '<svg></svg>', stderr = '') {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: Readable
    stderr: Readable
    stdin: Writable & { destroyed?: boolean }
  }
  proc.stdout = new Readable({ read() {} })
  proc.stderr = new Readable({ read() {} })
  proc.stdin = new Writable({
    write(_chunk, _enc, cb) { cb() },
    final(cb) {
      // Emit output after stdin closes
      setTimeout(() => {
        if (stdout) proc.stdout.push(Buffer.from(stdout))
        proc.stdout.push(null)
        if (stderr) proc.stderr.push(Buffer.from(stderr))
        proc.stderr.push(null)
        proc.emit('close', exitCode)
      }, 5)
      cb()
    }
  })
  return proc
}

describe('plantuml IPC — registerPlantumlHandlers', () => {
  beforeEach(() => {
    vi.resetModules()
    mockIpcMainHandle.mockReset()
    mockSpawn.mockReset()
    mockDialogShowOpenDialog.mockReset()
    mockBrowserWindowFromWebContents.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  async function loadAndRegister() {
    const mod = await import('main_renderer/ipc/plantuml')
    mod.registerPlantumlHandlers()
    return mod
  }

  it('registers three IPC handlers', async() => {
    await loadAndRegister()
    expect(mockIpcMainHandle).toHaveBeenCalledTimes(3)
    const channels = mockIpcMainHandle.mock.calls.map((c: unknown[]) => c[0])
    expect(channels).toContain('mt::plantuml::render-local')
    expect(channels).toContain('mt::plantuml::select-jar')
    expect(channels).toContain('mt::plantuml::select-java')
  })

  it('render-local returns error when jarPath is empty', async() => {
    await loadAndRegister()
    const renderHandler = mockIpcMainHandle.mock.calls.find(
      (c: unknown[]) => c[0] === 'mt::plantuml::render-local'
    )![1] as (_e: unknown, req: unknown) => Promise<unknown>

    const result = await renderHandler({}, { code: '@startuml\nA->B\n@enduml', jarPath: '', javaPath: '' })
    expect(result).toEqual({ error: 'plantuml.jar path is not configured' })
  })

  it('render-local spawns java with correct arguments and returns SVG', async() => {
    const proc = createMockProcess(0, '<svg>test</svg>')
    mockSpawn.mockReturnValue(proc)

    await loadAndRegister()
    const renderHandler = mockIpcMainHandle.mock.calls.find(
      (c: unknown[]) => c[0] === 'mt::plantuml::render-local'
    )![1] as (_e: unknown, req: unknown) => Promise<unknown>

    const result = await renderHandler({}, {
      code: '@startuml\nA->B\n@enduml',
      jarPath: '/usr/local/lib/plantuml.jar',
      javaPath: '/usr/bin/java'
    })

    expect(mockSpawn).toHaveBeenCalledWith(
      '/usr/bin/java',
      ['-jar', '/usr/local/lib/plantuml.jar', '-tsvg', '-charset', 'UTF-8', '-pipe'],
      expect.objectContaining({ stdio: ['pipe', 'pipe', 'pipe'], timeout: 30000 })
    )
    expect(result).toEqual({ svg: '<svg>test</svg>' })
  })

  it('render-local defaults javaPath to "java" when empty', async() => {
    const proc = createMockProcess(0, '<svg/>')
    mockSpawn.mockReturnValue(proc)

    await loadAndRegister()
    const renderHandler = mockIpcMainHandle.mock.calls.find(
      (c: unknown[]) => c[0] === 'mt::plantuml::render-local'
    )![1] as (_e: unknown, req: unknown) => Promise<unknown>

    await renderHandler({}, {
      code: '@startuml\n@enduml',
      jarPath: '/lib/plantuml.jar',
      javaPath: ''
    })

    expect(mockSpawn.mock.calls[0][0]).toBe('java')
  })

  it('render-local returns error when process exits non-zero', async() => {
    const proc = createMockProcess(1, '', 'Syntax Error in diagram')
    mockSpawn.mockReturnValue(proc)

    await loadAndRegister()
    const renderHandler = mockIpcMainHandle.mock.calls.find(
      (c: unknown[]) => c[0] === 'mt::plantuml::render-local'
    )![1] as (_e: unknown, req: unknown) => Promise<unknown>

    const result = await renderHandler({}, {
      code: 'bad code',
      jarPath: '/lib/plantuml.jar',
      javaPath: ''
    })

    expect(result).toEqual({ error: 'Syntax Error in diagram' })
  })

  it('render-local returns error when spawn fails (e.g. java not found)', async() => {
    const proc = new EventEmitter() as EventEmitter & {
      stdout: Readable
      stderr: Readable
      stdin: Writable
    }
    proc.stdout = new Readable({ read() {} })
    proc.stderr = new Readable({ read() {} })
    proc.stdin = new Writable({ write(_c, _e, cb) { cb() } })
    mockSpawn.mockReturnValue(proc)

    await loadAndRegister()
    const renderHandler = mockIpcMainHandle.mock.calls.find(
      (c: unknown[]) => c[0] === 'mt::plantuml::render-local'
    )![1] as (_e: unknown, req: unknown) => Promise<unknown>

    const promise = renderHandler({}, {
      code: '@startuml\n@enduml',
      jarPath: '/lib/plantuml.jar',
      javaPath: '/nonexistent/java'
    })

    proc.emit('error', new Error('ENOENT'))

    const result = await promise
    expect(result).toEqual({ error: 'Failed to start Java process: ENOENT' })
  })

  it('select-jar opens a file dialog filtered to .jar files', async() => {
    const fakeWin = {}
    mockBrowserWindowFromWebContents.mockReturnValue(fakeWin)
    mockDialogShowOpenDialog.mockResolvedValue({ filePaths: ['/chosen/plantuml.jar'] })

    await loadAndRegister()
    const selectHandler = mockIpcMainHandle.mock.calls.find(
      (c: unknown[]) => c[0] === 'mt::plantuml::select-jar'
    )![1] as (e: unknown) => Promise<unknown>

    const result = await selectHandler({ sender: {} })

    expect(mockDialogShowOpenDialog).toHaveBeenCalledWith(fakeWin, {
      properties: ['openFile'],
      filters: [{ name: 'JAR Files', extensions: ['jar'] }]
    })
    expect(result).toBe('/chosen/plantuml.jar')
  })

  it('select-jar returns empty string when no window is found', async() => {
    mockBrowserWindowFromWebContents.mockReturnValue(null)

    await loadAndRegister()
    const selectHandler = mockIpcMainHandle.mock.calls.find(
      (c: unknown[]) => c[0] === 'mt::plantuml::select-jar'
    )![1] as (e: unknown) => Promise<unknown>

    const result = await selectHandler({ sender: {} })
    expect(result).toBe('')
  })

  it('select-java opens a generic file dialog', async() => {
    const fakeWin = {}
    mockBrowserWindowFromWebContents.mockReturnValue(fakeWin)
    mockDialogShowOpenDialog.mockResolvedValue({ filePaths: ['/usr/bin/java'] })

    await loadAndRegister()
    const selectHandler = mockIpcMainHandle.mock.calls.find(
      (c: unknown[]) => c[0] === 'mt::plantuml::select-java'
    )![1] as (e: unknown) => Promise<unknown>

    const result = await selectHandler({ sender: {} })

    expect(mockDialogShowOpenDialog).toHaveBeenCalledWith(fakeWin, {
      properties: ['openFile']
    })
    expect(result).toBe('/usr/bin/java')
  })
})
