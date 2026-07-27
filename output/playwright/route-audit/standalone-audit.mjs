import { chromium } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const origin = 'http://127.0.0.1:5174'
const company = 'cmp_bert_ua'
const root = 'C:/mics/project/BertCRM/output/playwright/route-audit'
const axePath = 'C:/mics/project/BertCRM/node_modules/axe-core/axe.min.js'

const publicRoutes = [
  '/login',
  '/first-login',
  '/password-changed',
  '/access-help',
  '/access/setup',
  '/access/challenge',
  '/errors/offline',
  '/errors/500',
  '/errors/conflict',
  '/errors/maintenance',
  '/does-not-exist',
]

const adminRoutes = [
  `/overview?company=${company}`,
  `/tasks?company=${company}`,
  `/tasks/new?company=${company}`,
  `/tasks/tsk_design?company=${company}`,
  `/requests?company=${company}`,
  `/requests/new?type=absence&company=${company}`,
  `/calendar?company=${company}`,
  `/calendar/events/evt_review?company=${company}`,
  `/documents?company=${company}`,
  `/documents/doc_policy?company=${company}`,
  `/knowledge?company=${company}`,
  `/knowledge/bezpechna-robota-z-danymy?company=${company}`,
  `/employees?company=${company}`,
  `/employees/org?company=${company}`,
  `/employees/usr_maria?company=${company}`,
  `/analytics?company=${company}`,
  `/announcements?company=${company}`,
  `/announcements/new?company=${company}`,
  `/announcements/ann_policy?company=${company}`,
  `/notifications?company=${company}`,
  `/messages?company=${company}`,
  `/groups?company=${company}`,
  `/groups/grp_product_design?company=${company}`,
  `/drive?company=${company}`,
  `/drive/doc_policy?company=${company}`,
  `/settings/profile?company=${company}`,
  `/settings/notifications?company=${company}`,
  `/settings/security?company=${company}`,
  `/settings/sessions?company=${company}`,
  `/onboarding/life_onboarding?company=${company}`,
  `/offboarding/life_onboarding?company=${company}`,
  `/admin?company=${company}`,
  `/admin/users?company=${company}`,
  `/admin/users/usr_maria?company=${company}`,
  `/admin/companies?company=${company}`,
  `/admin/companies/cmp_bert_ua?company=${company}`,
  `/admin/roles?company=${company}`,
  `/admin/roles/role_employee?company=${company}`,
  `/admin/security?company=${company}`,
  `/admin/audit?company=${company}`,
  `/admin/import?company=${company}`,
  `/admin/system?company=${company}`,
]

const privateRoutes = [
  `/requests/req_absence_demo?company=${company}`,
  `/messages/thread_design?company=${company}`,
]

const artworkRoutes = [
  { path: `/drive?company=${company}&section=ARCHIVED`, artwork: 'workspace.webp' },
  { path: `/drive?company=${company}&q=definitely-no-file`, artwork: 'search.webp' },
  { path: `/employees?company=${company}&q=definitely-no-person`, artwork: 'search.webp' },
  { path: `/calendar?company=${company}&view=schedule&date=2035-01-01`, artwork: 'calendar.webp' },
]

const viewports = [
  { name: 'desktop', width: 1440, height: 960 },
  { name: 'mobile', width: 390, height: 844 },
]

function routeFileName(route, index) {
  const clean = route
    .replace(/^\/+/, '')
    .replace(/[?&=/:]+/g, '-')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .slice(0, 90) || 'root'
  return `${String(index + 1).padStart(2, '0')}-${clean}.png`
}

async function login(page, username) {
  await page.goto(`${origin}/login`, { waitUntil: 'domcontentloaded' })
  await page.getByLabel('Нікнейм').fill(username)
  await page.getByLabel('Пароль', { exact: true }).fill('BertDemoPassphrase2026!')
  await page.getByRole('button', { name: 'Увійти' }).click()
  await page.waitForURL('**/overview')
}

async function auditRoutes(page, routes, actor, screenshotPrefix = '') {
  const results = []
  for (const viewport of viewports) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    for (let index = 0; index < routes.length; index += 1) {
      const item = typeof routes[index] === 'string' ? { path: routes[index] } : routes[index]
      const consoleErrors = []
      const pageErrors = []
      const httpFailures = []
      const onConsole = (message) => {
        if (
          message.type() === 'error'
          && !message.text().includes('Failed to load resource')
          && !message.text().includes('net::ERR_ABORTED')
        ) {
          consoleErrors.push(message.text())
        }
      }
      const onPageError = (error) => pageErrors.push(error.message)
      const onResponse = (response) => {
        const url = response.url()
        if (
          url.startsWith(origin)
          && (response.status() >= 500 || (response.status() === 404 && (url.includes('/api/') || url.includes('/assets/'))))
        ) {
          httpFailures.push(`${response.status()} ${url.replace(origin, '')}`)
        }
      }
      page.on('console', onConsole)
      page.on('pageerror', onPageError)
      page.on('response', onResponse)

      let navigationError = ''
      try {
        await page.goto(`${origin}${item.path}`, { waitUntil: 'domcontentloaded', timeout: 20_000 })
        await page.waitForTimeout(850)
      } catch (error) {
        navigationError = error instanceof Error ? error.message : String(error)
      }

      let audit = {
        heading: '',
        title: '',
        finalPath: '',
        overflow: false,
        blank: true,
        brokenImages: [],
        axeViolations: [],
        artworkVisible: item.artwork ? false : null,
      }
      try {
        await page.addScriptTag({ path: axePath })
        audit = await page.evaluate(async (expectedArtwork) => {
          const visible = (element) => {
            const style = window.getComputedStyle(element)
            const rect = element.getBoundingClientRect()
            return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
          }
          const report = await window.axe.run(document, { resultTypes: ['violations'] })
          const artwork = expectedArtwork
            ? [...document.images].find((image) => image.src.endsWith(expectedArtwork))
            : null
          const main = document.querySelector('main, #main-content')
          return {
            heading: [...document.querySelectorAll('h1, h2, [role="heading"]')]
              .find(visible)?.textContent?.trim() ?? '',
            title: document.title,
            finalPath: window.location.pathname,
            overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
            blank: !main || (main.textContent?.trim().length ?? 0) < 8,
            brokenImages: [...document.images]
              .filter((image) => image.complete && image.naturalWidth === 0)
              .map((image) => image.getAttribute('src') ?? ''),
            axeViolations: report.violations.map((violation) => ({
              id: violation.id,
              impact: violation.impact,
              nodes: violation.nodes.length,
              targets: violation.nodes.slice(0, 4).map((node) => node.target),
            })),
            artworkVisible: expectedArtwork ? Boolean(artwork && visible(artwork)) : null,
          }
        }, item.artwork ?? '')
      } catch (error) {
        navigationError ||= error instanceof Error ? error.message : String(error)
      }

      const screenshotDirectory = path.join(root, 'screenshots', viewport.name)
      await mkdir(screenshotDirectory, { recursive: true })
      let screenshotError = ''
      try {
        await page.screenshot({
          path: path.join(screenshotDirectory, `${screenshotPrefix}${routeFileName(item.path, index)}`),
          fullPage: true,
        })
      } catch (error) {
        screenshotError = error instanceof Error ? error.message : String(error)
      }

      page.off('console', onConsole)
      page.off('pageerror', onPageError)
      page.off('response', onResponse)
      results.push({
        actor,
        viewport: viewport.name,
        route: item.path,
        navigationError,
        screenshotError,
        consoleErrors: [...new Set(consoleErrors)],
        pageErrors: [...new Set(pageErrors)],
        httpFailures: [...new Set(httpFailures)],
        ...audit,
      })
    }
  }
  return results
}

const browser = await chromium.launch({ headless: true })
const publicContext = await browser.newContext()
const adminContext = await browser.newContext()
const privateContext = await browser.newContext()
const publicPage = await publicContext.newPage()
const adminPage = await adminContext.newPage()
const privatePage = await privateContext.newPage()

await login(adminPage, 'dmytro')
await adminPage.goto(`${origin}/admin/audit?company=${company}`, { waitUntil: 'domcontentloaded' })
await adminPage.waitForTimeout(850)
const auditDetailHref = await adminPage.locator('a[href^="/admin/audit/"]').first().getAttribute('href')
if (auditDetailHref) adminRoutes.push(auditDetailHref)
await login(privatePage, 'maria')

const publicResults = await auditRoutes(publicPage, publicRoutes, 'anonymous', 'public-')
const adminResults = await auditRoutes(adminPage, adminRoutes, 'dmytro', 'admin-')
const privateResults = await auditRoutes(privatePage, privateRoutes, 'maria', 'private-')
const artworkResults = await auditRoutes(privatePage, artworkRoutes, 'maria', 'art-')
const results = [...publicResults, ...adminResults, ...privateResults, ...artworkResults]
const failures = results.filter((result) => (
  result.navigationError
  || result.screenshotError
  || result.consoleErrors.length
  || result.pageErrors.length
  || result.httpFailures.length
  || result.overflow
  || result.blank
  || result.brokenImages.length
  || result.axeViolations.length
  || result.artworkVisible === false
))
const declaredRouteCount = publicRoutes.length + adminRoutes.length + privateRoutes.length
const report = {
  generatedAt: new Date().toISOString(),
  declaredRouteCount,
  declaredScreenCount: declaredRouteCount * viewports.length,
  artworkScreenCount: artworkResults.length,
  totalScreenCount: results.length,
  passed: results.length - failures.length,
  failed: failures.length,
  failures,
  results,
}
await writeFile(path.join(root, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8')
await browser.close()

console.log(JSON.stringify({
  declaredRouteCount: report.declaredRouteCount,
  declaredScreenCount: report.declaredScreenCount,
  artworkScreenCount: report.artworkScreenCount,
  totalScreenCount: report.totalScreenCount,
  passed: report.passed,
  failed: report.failed,
  failures: failures.map((failure) => ({
    actor: failure.actor,
    viewport: failure.viewport,
    route: failure.route,
    navigationError: failure.navigationError,
    screenshotError: failure.screenshotError,
    consoleErrors: failure.consoleErrors,
    pageErrors: failure.pageErrors,
    httpFailures: failure.httpFailures,
    overflow: failure.overflow,
    blank: failure.blank,
    brokenImages: failure.brokenImages,
    axeViolations: failure.axeViolations,
    artworkVisible: failure.artworkVisible,
  })),
}, null, 2))
