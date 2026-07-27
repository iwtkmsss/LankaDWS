#!/usr/bin/env node
/**
 * Audit tracked repository files that are likely to waste coding-agent context.
 * No external dependencies. Run from repository root:
 *
 *   node scripts/audit-codex-context.mjs
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'

function gitFiles() {
  try {
    return execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
      .split('\0')
      .filter(Boolean)
  } catch (error) {
    console.error('Unable to run git ls-files. Run this script from a Git repository.')
    process.exit(1)
  }
}

const files = gitFiles()
const noisyRules = [
  ['root playwright state', (file) => file.startsWith('.playwright-cli/')],
  ['nested playwright state', (file) => file.includes('/.playwright-cli/')],
  ['output', (file) => file.startsWith('output/')],
  ['web artifacts', (file) => file.startsWith('apps/web/artifacts/')],
  ['web test results', (file) => file.startsWith('apps/web/test-results/')],
  ['generated prisma', (file) => file.startsWith('apps/api/src/generated/prisma/')],
  ['coverage', (file) => file.startsWith('coverage/') || file.includes('/coverage/')],
  ['dist', (file) => file.startsWith('dist/') || file.includes('/dist/')],
]

const counts = new Map(noisyRules.map(([name]) => [name, { files: 0, bytes: 0 }]))
const large = []
const sourceExtensions = new Set([
  '.ts', '.tsx', '.js', '.mjs', '.cjs', '.css', '.json', '.md', '.sql', '.prisma', '.yml', '.yaml',
])

for (const file of files) {
  let stat
  try {
    stat = fs.statSync(file)
  } catch {
    continue
  }

  for (const [name, match] of noisyRules) {
    if (match(file)) {
      const entry = counts.get(name)
      entry.files += 1
      entry.bytes += stat.size
    }
  }

  const extension = file.slice(file.lastIndexOf('.'))
  if (sourceExtensions.has(extension) && stat.size >= 100_000) {
    large.push({ file, bytes: stat.size })
  }
}

const human = (bytes) => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KiB`
  return `${(bytes / 1024 ** 2).toFixed(1)} MiB`
}

console.log(`Tracked files: ${files.length}`)
console.log('\nPotential context noise:')
for (const [name, value] of counts) {
  console.log(`- ${name}: ${value.files} files, ${human(value.bytes)}`)
}

console.log('\nLarge tracked text/source files (>= 100 KiB):')
for (const item of large.sort((a, b) => b.bytes - a.bytes).slice(0, 30)) {
  console.log(`- ${human(item.bytes)}  ${item.file}`)
}

const noisyTotal = [...counts.values()].reduce((sum, value) => sum + value.files, 0)
if (noisyTotal > 0) {
  console.log('\nRecommendation: review generated tracked files, move reusable scripts out of output/, then add ignore rules and git rm --cached generated artifacts.')
  process.exitCode = 2
} else {
  console.log('\nNo tracked files matched the configured noisy paths.')
}
