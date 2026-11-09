import { EventEmitter } from 'node:events'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetConfigForTests } from '../../config/config.js'

const { spawn } = vi.hoisted(() => ({ spawn: vi.fn() }))
vi.mock('node:child_process', () => ({ spawn }))

const { officePreviewPdf, OfficePreviewUnavailable } = await import('./office-preview.js')

let root: string
const sha = (seed: string) => seed.repeat(64).slice(0, 64)
const docx = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

/** Fake LibreOffice: writes `<outdir>/document.pdf` and exits with the given code. */
function fakeOffice({ exitCode = 0, writeOutput = true } = {}) {
  spawn.mockImplementation((_command: string, args: string[]) => {
    const child = Object.assign(new EventEmitter(), { pid: undefined, kill: vi.fn() })
    const outdir = args[args.indexOf('--outdir') + 1]
    setTimeout(() => {
      void (writeOutput ? writeFile(join(outdir, 'document.pdf'), '%PDF-preview') : Promise.resolve())
        .then(() => child.emit('exit', exitCode))
    }, 5)
    return child
  })
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'lankadws-office-preview-'))
  vi.stubEnv('FILE_STORAGE_DIR', join(root, 'clean'))
  vi.stubEnv('FILE_TEMP_DIR', join(root, 'tmp'))
  vi.stubEnv('OFFICE_PREVIEW_SOFFICE', 'soffice')
  resetConfigForTests()
  await mkdir(join(root, 'clean', 'company'), { recursive: true })
  await writeFile(join(root, 'clean', 'company', 'report'), 'docx bytes')
  spawn.mockReset()
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
  vi.unstubAllEnvs()
  resetConfigForTests()
})

describe('Office preview conversion', () => {
  it('converts a copy with the right extension once and serves the cached PDF afterwards', async () => {
    fakeOffice()
    const source = { storageKey: 'company/report', sha256: sha('a'), mime: docx }
    const path = await officePreviewPdf(source)
    expect(await readFile(path, 'utf8')).toBe('%PDF-preview')
    const args = spawn.mock.calls[0][1] as string[]
    expect(args).toEqual(expect.arrayContaining(['--headless', '--convert-to', 'pdf']))
    expect(args.at(-1)).toMatch(/document\.docx$/)
    expect((spawn.mock.calls[0][2] as { env: NodeJS.ProcessEnv }).env).toMatchObject({ SAL_DISABLE_PRINTERLIST: '1', SAL_DISABLE_DEFAULTPRINTER: '1' })
    expect(await officePreviewPdf(source)).toBe(path)
    expect(spawn).toHaveBeenCalledTimes(1)
    expect((await readdir(join(root, 'tmp'))).filter((name) => name.startsWith('office-convert-'))).toEqual([])
  })

  it('shares one conversion between simultaneous requests for the same content', async () => {
    fakeOffice()
    const source = { storageKey: 'company/report', sha256: sha('b'), mime: docx }
    const [first, second] = await Promise.all([officePreviewPdf(source), officePreviewPdf(source)])
    expect(first).toBe(second)
    expect(spawn).toHaveBeenCalledTimes(1)
  })

  it('reports a failed conversion without caching anything', async () => {
    fakeOffice({ exitCode: 1, writeOutput: false })
    const source = { storageKey: 'company/report', sha256: sha('c'), mime: docx }
    await expect(officePreviewPdf(source)).rejects.toBeInstanceOf(OfficePreviewUnavailable)
    fakeOffice()
    await expect(officePreviewPdf(source)).resolves.toMatch(/\.pdf$/)
    expect(spawn).toHaveBeenCalledTimes(2)
  })

  it('stays off when no converter is configured or the format is not an Office one', async () => {
    vi.stubEnv('OFFICE_PREVIEW_SOFFICE', '')
    resetConfigForTests()
    await expect(officePreviewPdf({ storageKey: 'company/report', sha256: sha('d'), mime: docx })).rejects.toBeInstanceOf(OfficePreviewUnavailable)
    vi.stubEnv('OFFICE_PREVIEW_SOFFICE', 'soffice')
    resetConfigForTests()
    await expect(officePreviewPdf({ storageKey: 'company/report', sha256: sha('e'), mime: 'application/zip' })).rejects.toBeInstanceOf(OfficePreviewUnavailable)
    await expect(officePreviewPdf({ storageKey: 'company/report', sha256: '../escape', mime: docx })).rejects.toBeInstanceOf(OfficePreviewUnavailable)
    expect(spawn).not.toHaveBeenCalled()
  })
})
