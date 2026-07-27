async (page) => {
  const origin = 'http://127.0.0.1:5174'
  const company = 'cmp_bert_ua'
  const routes = [
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
    `/overview?company=${company}`,
    `/tasks?company=${company}`,
    `/tasks/new?company=${company}`,
    `/tasks/tsk_design?company=${company}`,
    `/requests?company=${company}`,
    `/requests/new?type=absence&company=${company}`,
    `/requests/req_absence_demo?company=${company}`,
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
    `/messages/thread_design?company=${company}`,
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

  await page.goto(`${origin}/admin/audit?company=${company}`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(700)
  const auditHref = await page.locator('a[href^="/admin/audit/"]').first().getAttribute('href').catch(() => null)
  if (auditHref) routes.push(auditHref)

  const axePath = 'C:/mics/project/BertCRM/node_modules/axe-core/axe.min.js'
  const artifactRoot = 'C:/mics/project/BertCRM/output/playwright/route-audit/screenshots'
  const results = []
  let activeIssues = null
  page.on('pageerror', (error) => activeIssues?.pageErrors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') activeIssues?.consoleErrors.push(message.text())
  })
  page.on('response', (response) => {
    const url = response.url()
    if (
      activeIssues
      && url.startsWith(origin)
      && (response.status() >= 500 || (response.status() === 404 && (url.includes('/api/') || url.includes('/assets/'))))
    ) {
      activeIssues.httpFailures.push(`${response.status()} ${url.replace(origin, '')}`)
    }
  })

  const viewports = [
    { name: 'desktop', width: 1440, height: 960 },
    { name: 'mobile', width: 390, height: 844 },
  ]

  for (const viewport of viewports) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    for (let index = 0; index < routes.length; index += 1) {
      const route = routes[index]
      activeIssues = { pageErrors: [], consoleErrors: [], httpFailures: [] }
      let navigationError = ''
      try {
        await page.goto(`${origin}${route}`, { waitUntil: 'domcontentloaded', timeout: 15_000 })
        await page.waitForTimeout(650)
      } catch (error) {
        navigationError = error instanceof Error ? error.message : String(error)
      }

      let dom = {
        title: '',
        heading: '',
        overflow: false,
        blank: true,
        brokenImages: [],
        unnamedInteractive: [],
      }
      try {
        dom = await page.evaluate(() => {
          const visible = (element) => {
            const style = window.getComputedStyle(element)
            const rect = element.getBoundingClientRect()
            return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
          }
          const interactive = [...document.querySelectorAll('button, a[href], input, select, textarea')].filter(visible)
          const unnamedInteractive = interactive
            .filter((element) => {
              if (element.matches('input[type="hidden"]')) return false
              const labelledBy = element.getAttribute('aria-labelledby')
              const labelledText = labelledBy
                ? labelledBy.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? '').join(' ')
                : ''
              return ![
                element.getAttribute('aria-label'),
                element.getAttribute('title'),
                labelledText,
                element.textContent,
                element.getAttribute('placeholder'),
                element.getAttribute('alt'),
              ].some((value) => value?.trim())
            })
            .slice(0, 8)
            .map((element) => element.outerHTML.slice(0, 180))
          const brokenImages = [...document.images]
            .filter((image) => image.complete && image.naturalWidth === 0)
            .map((image) => image.getAttribute('src') ?? '')
          const heading = [...document.querySelectorAll('h1, h2, [role="heading"]')]
            .find(visible)?.textContent?.trim() ?? ''
          const main = document.querySelector('main, #main-content')
          return {
            title: document.title,
            heading,
            overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
            blank: !main || (main.textContent?.trim().length ?? 0) < 8,
            brokenImages,
            unnamedInteractive,
          }
        })
      } catch (error) {
        navigationError ||= error instanceof Error ? error.message : String(error)
      }

      let axeViolations = []
      try {
        await page.addScriptTag({ path: axePath })
        axeViolations = await page.evaluate(async () => {
          const report = await window.axe.run(document, {
            resultTypes: ['violations'],
          })
          return report.violations.map((violation) => ({
            id: violation.id,
            impact: violation.impact,
            nodes: violation.nodes.length,
          }))
        })
      } catch (error) {
        axeViolations = [{
          id: 'axe-run-failed',
          impact: 'critical',
          nodes: 1,
          message: error instanceof Error ? error.message : String(error),
        }]
      }

      const safeName = `${String(index + 1).padStart(2, '0')}-${route
        .replace(/^\/+/, '')
        .replace(/[?&=/:]+/g, '-')
        .replace(/[^a-zA-Z0-9_-]+/g, '-')
        .slice(0, 90) || 'root'}.png`
      let screenshotError = ''
      try {
        await page.screenshot({
          path: `${artifactRoot}/${viewport.name}/${safeName}`,
          fullPage: true,
        })
      } catch (error) {
        screenshotError = error instanceof Error ? error.message : String(error)
      }

      const issues = activeIssues
      const isExpectedExistenceSafeDenial = [
        `/requests/req_absence_demo?company=${company}`,
        `/messages/thread_design?company=${company}`,
      ].includes(route)
      if (isExpectedExistenceSafeDenial) {
        issues.httpFailures = []
        issues.consoleErrors = issues.consoleErrors.filter((message) => !message.includes('Failed to load resource'))
      }
      results.push({
        viewport: viewport.name,
        route,
        finalPath: page.url().replace(origin, '').split('?')[0],
        heading: dom.heading,
        title: dom.title,
        navigationError,
        screenshotError,
        overflow: dom.overflow,
        blank: dom.blank,
        brokenImages: dom.brokenImages,
        unnamedInteractive: dom.unnamedInteractive,
        axeViolations,
        pageErrors: issues.pageErrors,
        consoleErrors: [...new Set(issues.consoleErrors)].slice(0, 8),
        httpFailures: [...new Set(issues.httpFailures)].slice(0, 8),
      })
      activeIssues = null
    }
  }

  const failures = results.filter((result) => (
    result.navigationError
    || result.screenshotError
    || result.overflow
    || result.blank
    || result.brokenImages.length
    || result.axeViolations.length
    || result.pageErrors.length
    || result.consoleErrors.length
    || result.httpFailures.length
  ))
  return {
    routeCount: routes.length,
    screenCount: results.length,
    passed: results.length - failures.length,
    failed: failures.length,
    routes,
    failures,
  }
}
