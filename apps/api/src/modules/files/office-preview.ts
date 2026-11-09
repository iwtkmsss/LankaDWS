import { spawn } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, rename, rm, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { getConfig } from '../../config/config.js'
import { cleanFilePath } from './storage.js'

/** LibreOffice picks the import filter from the extension, so the copy it converts carries one. */
const OFFICE_EXTENSIONS: Record<string, string> = {
  'application/msword': 'doc',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/vnd.oasis.opendocument.text': 'odt',
  'application/vnd.oasis.opendocument.spreadsheet': 'ods',
  'application/vnd.oasis.opendocument.presentation': 'odp',
  'application/rtf': 'rtf',
  'text/rtf': 'rtf',
}

export class OfficePreviewUnavailable extends Error {
  constructor(reason: string) {
    super(reason)
    this.name = 'OfficePreviewUnavailable'
  }
}

interface PreviewSource { storageKey: string; sha256: string; mime: string }

const tempRoot = () => resolve(getConfig().FILE_TEMP_DIR)
/** Previews are a disposable cache keyed by content, so copies of one file share a single PDF. */
const previewPath = (sha256: string) => join(tempRoot(), 'office-previews', `${sha256}.pdf`)

// One conversion at a time: LibreOffice is memory hungry and its profile is not safe for parallel use.
let queue: Promise<unknown> = Promise.resolve()
const inFlight = new Map<string, Promise<string>>()

async function exists(path: string) {
  try {
    return (await stat(path)).isFile()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

function run(command: string, args: string[], timeoutMs: number): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const windows = process.platform === 'win32'
    // On Linux `soffice` is a launcher script; a process group lets a timeout stop the real office process too.
    const child = spawn(command, args, {
      detached: !windows,
      stdio: 'ignore',
      windowsHide: true,
      // PDF export needs no printer. Without these LibreOffice queries the system printers on start,
      // which waits up to a minute on an offline network printer and can show a dialog on a desktop.
      env: { ...process.env, SAL_DISABLE_PRINTERLIST: '1', SAL_DISABLE_DEFAULTPRINTER: '1' },
    })
    let settled = false
    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error) reject(error)
      else resolvePromise()
    }
    const timer = setTimeout(() => {
      try {
        if (!windows && child.pid) process.kill(-child.pid, 'SIGKILL')
        else child.kill('SIGKILL')
      } catch { /* already gone */ }
      finish(new OfficePreviewUnavailable('ConverterTimeout'))
    }, timeoutMs)
    child.on('error', () => finish(new OfficePreviewUnavailable('ConverterMissing')))
    child.on('exit', (code) => finish(code === 0 ? undefined : new OfficePreviewUnavailable('ConverterFailed')))
  })
}

async function convert(source: PreviewSource, target: string): Promise<string> {
  if (await exists(target)) return target
  const config = getConfig()
  const extension = OFFICE_EXTENSIONS[source.mime]
  if (!config.OFFICE_PREVIEW_SOFFICE || !extension) throw new OfficePreviewUnavailable('ConverterDisabled')
  const root = tempRoot()
  await mkdir(root, { recursive: true })
  const work = await mkdtemp(join(root, 'office-convert-'))
  try {
    const input = join(work, `document.${extension}`)
    await copyFile(cleanFilePath(source.storageKey), input)
    const profile = pathToFileURL(join(root, 'office-profile')).href
    await run(config.OFFICE_PREVIEW_SOFFICE, [
      '--headless', '--invisible', '--nologo', '--nodefault', '--norestore', '--nolockcheck',
      `-env:UserInstallation=${profile}`,
      '--convert-to', 'pdf', '--outdir', work, input,
    ], config.OFFICE_PREVIEW_TIMEOUT_MS)
    const output = join(work, 'document.pdf')
    if (!await exists(output)) throw new OfficePreviewUnavailable('ConverterNoOutput')
    await mkdir(join(root, 'office-previews'), { recursive: true })
    await rename(output, target)
    return target
  } finally {
    await rm(work, { recursive: true, force: true })
  }
}

/** Path of a PDF rendering of a scanned Office file; converts it on first use. */
export async function officePreviewPdf(source: PreviewSource): Promise<string> {
  if (!/^[a-f0-9]{64}$/.test(source.sha256)) throw new OfficePreviewUnavailable('InvalidDigest')
  const target = previewPath(source.sha256)
  if (await exists(target)) return target
  const pending = inFlight.get(source.sha256)
  if (pending) return pending
  const job = queue.then(() => convert(source, target))
  queue = job.catch(() => undefined)
  inFlight.set(source.sha256, job)
  try {
    return await job
  } finally {
    inFlight.delete(source.sha256)
  }
}
