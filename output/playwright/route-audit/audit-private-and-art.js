async (page) => {
  const origin = 'http://127.0.0.1:5174'
  await page.context().clearCookies()
  await page.goto(`${origin}/login`, { waitUntil: 'domcontentloaded' })
  await page.getByLabel('Нікнейм').fill('maria')
  await page.getByLabel('Пароль', { exact: true }).fill('BertDemoPassphrase2026!')
  await page.getByRole('button', { name: 'Увійти' }).click()
  await page.waitForURL('**/overview')

  const routes = [
    { name: 'request-detail', path: '/requests/req_absence_demo?company=cmp_bert_ua' },
    { name: 'chat-detail', path: '/messages/thread_design?company=cmp_bert_ua' },
    { name: 'drive-empty', path: '/drive?company=cmp_bert_ua&section=ARCHIVED', art: 'workspace.webp' },
    { name: 'drive-search-empty', path: '/drive?company=cmp_bert_ua&q=definitely-no-file', art: 'search.webp' },
    { name: 'employees-search-empty', path: '/employees?company=cmp_bert_ua&q=definitely-no-person', art: 'search.webp' },
    { name: 'calendar-empty', path: '/calendar?company=cmp_bert_ua&view=schedule&date=2035-01-01', art: 'calendar.webp' },
  ]
  const viewports = [
    { name: 'desktop', width: 1440, height: 960 },
    { name: 'mobile', width: 390, height: 844 },
  ]
  const results = []
  for (const viewport of viewports) {
    await page.setViewportSize(viewport)
    for (const route of routes) {
      const responseFailures = []
      const responseHandler = (response) => {
        if (response.url().startsWith(origin) && response.status() >= 400) {
          responseFailures.push(`${response.status()} ${response.url().replace(origin, '')}`)
        }
      }
      page.on('response', responseHandler)
      await page.goto(`${origin}${route.path}`, { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(900)
      page.off('response', responseHandler)
      await page.addScriptTag({ path: 'C:/mics/project/BertCRM/node_modules/axe-core/axe.min.js' })
      const audit = await page.evaluate(async (expectedArt) => {
        const report = await window.axe.run(document, { resultTypes: ['violations'] })
        const image = expectedArt
          ? [...document.images].find((item) => item.src.endsWith(expectedArt))
          : null
        return {
          heading: document.querySelector('h1, h2')?.textContent?.trim() ?? '',
          overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
          brokenImages: [...document.images]
            .filter((item) => item.complete && item.naturalWidth === 0)
            .map((item) => item.src),
          axeViolations: report.violations.map((violation) => ({
            id: violation.id,
            impact: violation.impact,
            nodes: violation.nodes.length,
          })),
          artworkVisible: expectedArt ? Boolean(image && image.getBoundingClientRect().width > 0) : null,
        }
      }, route.art ?? '')
      await page.screenshot({
        path: `C:/mics/project/BertCRM/output/playwright/route-audit/screenshots/${viewport.name}/art-${route.name}.png`,
        fullPage: true,
      })
      results.push({ viewport: viewport.name, route: route.path, responseFailures, ...audit })
    }
  }
  return {
    screenCount: results.length,
    failures: results.filter((result) => (
      result.responseFailures.length
      || result.overflow
      || result.brokenImages.length
      || result.axeViolations.length
      || result.artworkVisible === false
    )),
    results,
  }
}
