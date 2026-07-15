import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

async function login(page: Page, username = 'maria') {
  await page.goto('/login')
  await page.getByLabel('Нікнейм').fill(username)
  await page.getByLabel('Пароль', { exact: true }).fill('BertDemoPassphrase2026!')
  await page.getByRole('button', { name: 'Увійти' }).click()
  await expect(page).toHaveURL(/\/overview$/)
  await expect(page.getByRole('heading', { name: 'Огляд', exact: true })).toBeVisible()
}

test('employee overview, canonical navigation and absence wizard are accessible', async ({ page }, testInfo) => {
  await login(page)
  await expect(page.getByText('Марія Іваненко')).toBeVisible()
  const overviewA11y = await new AxeBuilder({ page }).analyze()
  expect(overviewA11y.violations).toEqual([])
  await page.screenshot({ path: `artifacts/screenshots/${testInfo.project.name}-overview.png`, fullPage: true })
  await page.goto('/requests/new?type=absence')
  await expect(page.getByRole('heading', { name: 'Коли вас не буде?' })).toBeVisible()
  await page.getByLabel('Перший день').fill('2027-03-15')
  await page.getByLabel('Останній день').fill('2027-03-19')
  await page.getByRole('button', { name: /Далі/ }).click()
  await expect(page.getByRole('heading', { name: 'Хто підстрахує?' })).toBeVisible()
})

test('manager receives an approval queue and admin content does not flash for employee', async ({ page }) => {
  await login(page, 'andrii')
  await expect(page.getByText('Потребують рішення')).toBeVisible()
  await page.goto('/admin/roles')
  await expect(page.getByRole('heading', { name: 'У вас немає доступу' })).toBeVisible()
  await expect(page.getByText('Ролі та права')).toHaveCount(0)
})

test('administrator sees the approved nested admin navigation', async ({ page }, testInfo) => {
  await login(page, 'dmytro')
  await page.goto('/admin')
  await expect(page.getByRole('heading', { name: 'Адміністрування', exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Користувачі', exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Ролі та права', exact: true })).toBeVisible()
  await page.screenshot({ path: `artifacts/screenshots/${testInfo.project.name}-admin.png`, fullPage: true })
})

test('unknown route preserves URL and renders branded 404', async ({ page }) => {
  await page.goto('/does-not-exist')
  await expect(page).toHaveURL(/does-not-exist/)
  await expect(page.getByRole('heading', { name: 'Такої сторінки немає' })).toBeVisible()
})

test('company scope, task filters and browser history remain URL-addressable', async ({ page }) => {
  await login(page)
  await page.getByRole('button', { name: /BERT Україна/ }).click()
  await page.getByRole('option', { name: /Усі компанії/ }).click()
  await expect(page).toHaveURL(/company=all/)
  await page.getByRole('button', { name: 'Пошук у BERT CRM' }).click()
  const palette = page.getByRole('dialog', { name: 'Глобальний пошук' })
  await palette.getByRole('textbox').fill('dashboard')
  await palette.getByRole('button', { name: /Підготувати концепцію дизайну dashboard/ }).click()
  await expect(page).toHaveURL(/\/tasks\/tsk_design\?company=all/)
  await page.goBack()
  const mobileTaskLink = page.locator('.bottom-nav').getByRole('link', { name: 'Завдання', exact: true })
  const taskLink = (await mobileTaskLink.isVisible()) ? mobileTaskLink : page.locator('.sidebar').getByRole('link', { name: 'Завдання', exact: true })
  await taskLink.click()
  await expect(page).toHaveURL(/\/tasks\?company=all/)
  await page.getByRole('button', { name: 'Фільтри' }).click()
  await page.getByLabel('Пошук завдань').fill('dashboard')
  await page.getByLabel('Статус').selectOption('IN_PROGRESS')
  await expect(page).toHaveURL(/search=dashboard/)
  await expect(page).toHaveURL(/status=IN_PROGRESS/)
  await page.getByRole('link', { name: /Підготувати концепцію дизайну dashboard/ }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.goBack()
  await expect(page).toHaveURL(/search=dashboard/)
  await expect(page.getByRole('dialog')).toHaveCount(0)
})
