async (page) => {
  const origin = 'http://127.0.0.1:5174'
  const routes = [
    '/tasks?company=cmp_bert_ua',
    '/requests/new?type=absence&company=cmp_bert_ua',
    '/requests/req_absence_demo?company=cmp_bert_ua',
    '/messages/thread_design?company=cmp_bert_ua',
    '/onboarding/life_onboarding?company=cmp_bert_ua',
    '/admin/import?company=cmp_bert_ua',
  ]
  const reports = []
  for (const route of routes) {
    await page.goto(`${origin}${route}`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(700)
    await page.addScriptTag({ path: 'C:/mics/project/BertCRM/node_modules/axe-core/axe.min.js' })
    const violations = await page.evaluate(async () => {
      const report = await window.axe.run(document, { resultTypes: ['violations'] })
      return report.violations.map((violation) => ({
        id: violation.id,
        impact: violation.impact,
        nodes: violation.nodes.map((node) => ({
          target: node.target,
          html: node.html,
          failureSummary: node.failureSummary,
        })),
      }))
    })
    reports.push({ route, violations })
  }
  return reports
}
