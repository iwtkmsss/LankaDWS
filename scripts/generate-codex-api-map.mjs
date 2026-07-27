#!/usr/bin/env node
/**
 * Generate a compact Codex-facing API route map from artifacts/openapi.json.
 * No external dependencies.
 *
 * Usage:
 *   node scripts/generate-codex-api-map.mjs
 *   node scripts/generate-codex-api-map.mjs artifacts/openapi.json docs/codex/api-map.md
 */
import fs from 'node:fs'
import path from 'node:path'

const input = process.argv[2] ?? 'artifacts/openapi.json'
const output = process.argv[3] ?? 'docs/codex/api-map.md'

if (!fs.existsSync(input)) {
  console.error(`OpenAPI file not found: ${input}`)
  process.exit(1)
}

let spec
try {
  spec = JSON.parse(fs.readFileSync(input, 'utf8'))
} catch (error) {
  console.error(`Cannot parse ${input}:`, error instanceof Error ? error.message : error)
  process.exit(1)
}

if (!spec.paths || typeof spec.paths !== 'object') {
  console.error(`Invalid OpenAPI document: missing paths object`)
  process.exit(1)
}

const methods = new Set(['get', 'post', 'put', 'patch', 'delete', 'options', 'head'])
const rows = []

for (const [route, pathItem] of Object.entries(spec.paths)) {
  if (!pathItem || typeof pathItem !== 'object') continue
  for (const [method, operation] of Object.entries(pathItem)) {
    if (!methods.has(method.toLowerCase()) || !operation || typeof operation !== 'object') continue
    const tags = Array.isArray(operation.tags) && operation.tags.length
      ? operation.tags.join(', ')
      : 'Untagged'
    rows.push({
      tags,
      method: method.toUpperCase(),
      route,
      operationId: typeof operation.operationId === 'string' ? operation.operationId : '',
      summary: typeof operation.summary === 'string' ? operation.summary : '',
    })
  }
}

rows.sort((a, b) =>
  a.tags.localeCompare(b.tags)
  || a.route.localeCompare(b.route)
  || a.method.localeCompare(b.method),
)

const grouped = new Map()
for (const row of rows) {
  const list = grouped.get(row.tags) ?? []
  list.push(row)
  grouped.set(row.tags, list)
}

const lines = [
  '# BertCRM API route map',
  '',
  `Generated from \`${input}\`. Do not edit manually.`,
  '',
  `Total operations: **${rows.length}**`,
  '',
]

for (const [tag, items] of grouped) {
  lines.push(`## ${tag}`, '')
  lines.push('| Method | Path | Operation | Summary |')
  lines.push('|---|---|---|---|')
  for (const item of items) {
    const escape = (value) => String(value).replaceAll('|', '\\|').replaceAll('\n', ' ')
    lines.push(`| \`${item.method}\` | \`${escape(item.route)}\` | \`${escape(item.operationId)}\` | ${escape(item.summary)} |`)
  }
  lines.push('')
}

fs.mkdirSync(path.dirname(output), { recursive: true })
fs.writeFileSync(output, `${lines.join('\n')}\n`, 'utf8')
console.log(`Wrote ${rows.length} operations to ${output}`)
