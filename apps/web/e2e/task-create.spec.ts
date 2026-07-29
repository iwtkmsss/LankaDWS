import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import type { CreateTaskInput } from '@bert-crm/contracts'

async function login(page: Page) {
  await page.goto('/login')
  await page.getByLabel('Нікнейм').fill('maria')
  await page.getByLabel('Пароль', { exact: true }).fill('BertDemoPassphrase2026!')
  await page.getByRole('button', { name: 'Увійти' }).click()
  await expect(page).toHaveURL(/\/overview$/)
}

function futureLocalDateTime(daysFromNow: number): string {
  const date = new Date(Date.now() + daysFromNow * 24 * 60 * 60 * 1_000)
  date.setSeconds(0, 0)
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
}

test('creates a task through the complete modal workflow', async ({ page }, testInfo) => {
  await login(page)
  await page.goto('/tasks/new')

  const dialog = page.getByRole('dialog', { name: 'Нове завдання' })
  await expect(dialog).toBeVisible()
  await expect(page.getByLabel('Розділи форми').getByRole('button')).toHaveCount(5)
  await expect(page.getByLabel('Назва завдання')).toBeFocused()
  await expect(page.evaluate(() => document.body.style.overflow)).resolves.toBe('hidden')

  const title = `E2E створення · ${testInfo.project.name} · ${Date.now()}`
  await page.getByLabel('Назва завдання').fill(title)
  await page.getByLabel('Опис').fill('Перевірка повної форми створення завдання.')
  await dialog.getByRole('combobox', { name: /^Проєкт/ }).selectOption('prj_website')
  await page.getByLabel('Пріоритет').selectOption('URGENT')
  await page.getByLabel('Дата початку').fill(futureLocalDateTime(2))
  await page.getByLabel('Кінцевий термін').fill(futureLocalDateTime(4))
  await page.getByText('Дизайн', { exact: true }).click()
  const attachmentName = `task-create-${testInfo.project.name}.txt`
  await dialog.locator('input[type="file"]').setInputFiles({
    name: attachmentName,
    mimeType: 'text/plain',
    buffer: Buffer.from('Task creation modal E2E attachment'),
  })
  await expect(dialog.locator('.task-create-attachments li').filter({ hasText: attachmentName })).toBeVisible()

  await page.getByLabel('Розділи форми').getByRole('button', { name: 'Учасники' }).click()
  await expect(dialog.getByRole('heading', { name: 'Учасники' })).toBeVisible()
  await dialog.getByText('Андрій Коваль', { exact: true }).click()
  await page.getByLabel('Роль: Андрій Коваль').selectOption('RESPONSIBLE')
  await dialog.getByText('Олена Бондар', { exact: true }).click()
  await page.getByLabel('Роль: Олена Бондар').selectOption('COLLABORATOR')

  await page.getByLabel('Розділи форми').getByRole('button', { name: 'Чек-ліст' }).click()
  await page.getByLabel('Новий пункт').fill('Перевірити результат')
  await page.getByRole('button', { name: 'Додати', exact: true }).click()
  await expect(page.getByLabel('Назва пункту 1')).toHaveValue('Перевірити результат')

  await page.getByLabel('Розділи форми').getByRole('button', { name: 'Планування' }).click()
  await page.getByLabel('Планова оцінка, хвилини').fill('120')
  await page.getByRole('button', { name: 'Додати', exact: true }).click()
  await page.getByLabel('Коли').selectOption('BEFORE_DUE')
  await page.getByLabel('За скільки хвилин').fill('45')
  await dialog.locator('.task-create-switch input[type="checkbox"]').check()
  await page.getByLabel('Максимум екземплярів').fill('3')

  await page.getByLabel('Розділи форми').getByRole('button', { name: 'Зв’язки' }).click()
  await dialog.getByRole('combobox', { name: /^Завдання/ }).selectOption('tsk_design')
  await page.getByRole('button', { name: 'Додати зв’язок' }).click()
  await expect(dialog.getByText(/TSK-2401 · Підготувати концепцію дизайну dashboard/)).toBeVisible()

  const accessibility = await new AxeBuilder({ page }).include('.task-create-dialog').analyze()
  expect(accessibility.violations).toEqual([])

  const createRequestPromise = page.waitForRequest(
    (request) => request.method() === 'POST' && new URL(request.url()).pathname === '/api/v1/tasks',
  )
  await page.getByRole('button', { name: 'Створити завдання' }).click()
  const createRequest = await createRequestPromise
  const payload = createRequest.postDataJSON() as CreateTaskInput
  expect(payload).toMatchObject({
    title,
    description: 'Перевірка повної форми створення завдання.',
    projectId: 'prj_website',
    reporterId: 'usr_maria',
    priority: 'URGENT',
    estimatedMinutes: 120,
    tagIds: ['tag_design'],
    checklistItems: [expect.objectContaining({ title: 'Перевірити результат', isCompleted: false })],
    relations: [{ targetTaskId: 'tsk_design', type: 'RELATED' }],
    reminders: [
      {
        target: { type: 'PARTICIPANTS' },
        trigger: { type: 'BEFORE_DUE', offsetMinutes: 45 },
      },
    ],
    recurrence: expect.objectContaining({
      frequency: 'WEEKLY',
      interval: 1,
      maxOccurrences: 3,
    }),
  })
  expect(payload.participants).toEqual(
    expect.arrayContaining([
      { userId: 'usr_maria', role: 'RESPONSIBLE' },
      { userId: 'usr_andrii', role: 'RESPONSIBLE' },
      { userId: 'usr_olena', role: 'COLLABORATOR' },
    ]),
  )
  expect(payload.attachmentIds).toHaveLength(1)
  await expect(page).toHaveURL(/\/tasks\/tsk_/)
  await expect(page.getByRole('dialog', { name: 'Нове завдання' })).toHaveCount(0)
  const detailDialog = page.getByRole('dialog')
  await expect(detailDialog.getByRole('heading', { name: title })).toBeVisible()
  await expect(page.evaluate(() => document.body.style.overflow)).resolves.toBe('hidden')
  await detailDialog.getByRole('button', { name: 'Закрити' }).click()
  await expect(page).toHaveURL(/\/tasks$/)
  await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe('')
})
