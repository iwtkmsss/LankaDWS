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

test('shared modal shell traps focus, guards dirty closure and stays responsive', async ({ page }, testInfo) => {
  await login(page)
  if (testInfo.project.name === 'mobile-chromium') {
    await page.setViewportSize({ width: 320, height: 720 })
  }
  await page.goto('/tasks/new')

  const dialog = page.locator('.task-create-dialog')
  const modalBody = dialog.locator(':scope > .overlay__body')
  await expect(dialog).toBeVisible()
  await expect(modalBody).toHaveCount(1)
  await expect(page.evaluate(() => document.body.style.position)).resolves.toBe('fixed')
  await expect(page.locator('.overlay-layer--modal')).toHaveCSS('backdrop-filter', 'none')

  const verticalScrollContainers = await dialog.locator('*').evaluateAll((elements) => (
    elements.filter((element) => {
      if (element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) return false
      const overflow = getComputedStyle(element).overflowY
      return overflow === 'auto' || overflow === 'scroll'
    }).map((element) => element.className)
  ))
  expect(verticalScrollContainers).toEqual([expect.stringContaining('overlay__body')])
  expect(await page.evaluate(() => (
    document.documentElement.scrollWidth <= document.documentElement.clientWidth
  ))).toBe(true)

  if (testInfo.project.name === 'mobile-chromium') {
    const box = await dialog.boundingBox()
    const viewport = page.viewportSize()
    expect(box).not.toBeNull()
    expect(viewport).not.toBeNull()
    expect(Math.abs(box!.x)).toBeLessThanOrEqual(1)
    expect(Math.abs(box!.y)).toBeLessThanOrEqual(1)
    expect(Math.abs(box!.width - viewport!.width)).toBeLessThanOrEqual(1)
    expect(Math.abs(box!.height - viewport!.height)).toBeLessThanOrEqual(1)
    const cancelBox = await dialog.getByRole('button', { name: 'Скасувати' }).boundingBox()
    const createBox = await dialog.getByRole('button', { name: 'Створити завдання' }).boundingBox()
    expect(cancelBox).not.toBeNull()
    expect(createBox).not.toBeNull()
    expect(createBox!.width).toBeGreaterThan(cancelBox!.width)
  }

  const header = dialog.locator(':scope > .overlay__header')
  const footer = dialog.locator(':scope > .overlay__footer')
  const fixedRowsBefore = await Promise.all([header.boundingBox(), footer.boundingBox()])
  await modalBody.evaluate((element) => {
    element.scrollTop = element.scrollHeight
  })
  const fixedRowsAfter = await Promise.all([header.boundingBox(), footer.boundingBox()])
  expect(fixedRowsAfter[0]?.y).toBe(fixedRowsBefore[0]?.y)
  expect(fixedRowsAfter[1]?.y).toBe(fixedRowsBefore[1]?.y)

  const createButton = dialog.getByRole('button', { name: 'Створити завдання' })
  await createButton.focus()
  await page.keyboard.press('Tab')
  await expect(dialog.getByRole('button', { name: 'Закрити' })).toBeFocused()

  await page.getByLabel('Назва завдання').fill(`Незавершена форма · ${testInfo.project.name}`)
  await page.keyboard.press('Escape')
  const confirmation = page.getByRole('alertdialog', { name: 'Закрити форму?' })
  await expect(confirmation).toBeVisible()
  await expect(confirmation.getByRole('button', { name: 'Продовжити редагування' })).toBeFocused()
  await expect(dialog).toHaveAttribute('aria-hidden', 'true')

  await page.keyboard.press('Escape')
  await expect(confirmation).toHaveCount(0)
  await expect(dialog).toBeVisible()
  await expect(page.evaluate(() => document.body.style.position)).resolves.toBe('fixed')

  await dialog.getByRole('button', { name: 'Закрити' }).click()
  await expect(confirmation).toBeVisible()
  await confirmation.getByRole('button', { name: 'Продовжити редагування' }).click()
  await expect(confirmation).toHaveCount(0)

  await page.locator('.sidebar a[href="/overview"]').evaluate((element) => {
    (element as HTMLElement).click()
  })
  await expect(confirmation).toBeVisible()
  await expect(page).toHaveURL(/\/tasks\/new$/)
  await confirmation.getByRole('button', { name: 'Зберегти чернетку і закрити' }).click()
  await expect(page).toHaveURL(/\/overview$/)
  await expect.poll(() => page.evaluate(() => document.body.style.position)).toBe('')
})

test('creates a task through the complete modal workflow', async ({ page }, testInfo) => {
  await login(page)
  await page.goto('/tasks/new')

  const dialog = page.getByRole('dialog', { name: 'Нове завдання' })
  await expect(dialog).toBeVisible()
  await expect(page.getByLabel('Назва завдання')).toBeFocused()
  await expect(page.evaluate(() => document.body.style.overflow)).resolves.toBe('hidden')

  const contextToggle = dialog.getByRole('button', { name: /^Контекст і матеріали/ })
  const participantsToggle = dialog.getByRole('button', { name: /^Учасники/ })
  const checklistToggle = dialog.getByRole('button', { name: /^Чек-ліст/ })
  const planningToggle = dialog.getByRole('button', { name: /^Планування/ })
  const relationsToggle = dialog.getByRole('button', { name: /^Зв’язки/ })
  await expect(contextToggle).toHaveAttribute('aria-expanded', 'false')
  await expect(participantsToggle).toHaveAttribute('aria-expanded', 'false')
  await expect(checklistToggle).toHaveAttribute('aria-expanded', 'false')
  await expect(planningToggle).toHaveAttribute('aria-expanded', 'false')
  await expect(relationsToggle).toHaveAttribute('aria-expanded', 'false')

  const title = `E2E створення · ${testInfo.project.name} · ${Date.now()}`
  await page.getByLabel('Назва завдання').fill(title)
  await page.getByLabel('Опис').fill('Перевірка повної форми створення завдання.')
  await page.getByLabel('Додати відповідального').selectOption('usr_andrii')
  await page.getByLabel('Пріоритет').selectOption('URGENT')
  await page.getByLabel('Дата початку').fill(futureLocalDateTime(2))
  await page.getByLabel('Кінцевий термін').fill(futureLocalDateTime(4))

  await contextToggle.click()
  await expect(contextToggle).toHaveAttribute('aria-expanded', 'true')
  await dialog.getByRole('combobox', { name: /^Проєкт/ }).selectOption('prj_website')
  await page.getByText('Дизайн', { exact: true }).click()
  const attachmentName = `task-create-${testInfo.project.name}.txt`
  await dialog.locator('input[type="file"]').setInputFiles({
    name: attachmentName,
    mimeType: 'text/plain',
    buffer: Buffer.from('Task creation modal E2E attachment'),
  })
  await expect(dialog.locator('.task-create-attachments li').filter({ hasText: attachmentName })).toBeVisible()

  await participantsToggle.click()
  await expect(participantsToggle).toHaveAttribute('aria-expanded', 'true')
  await expect(contextToggle).toHaveAttribute('aria-expanded', 'true')
  await dialog.getByText('Олена Бондар', { exact: true }).click()
  await page.getByLabel('Роль: Олена Бондар').selectOption('COLLABORATOR')

  await checklistToggle.click()
  const checklistPanel = dialog.locator('#task-create-checklist-panel')
  await checklistPanel.getByLabel('Новий пункт').fill('Перевірити результат')
  await checklistPanel.getByRole('button', { name: 'Додати', exact: true }).click()
  await expect(page.getByLabel('Назва пункту 1')).toHaveValue('Перевірити результат')

  await planningToggle.click()
  const planningPanel = dialog.locator('#task-create-planning-panel')
  await planningPanel.getByLabel('Планова оцінка, хвилини').fill('120')
  await planningPanel.getByRole('button', { name: 'Додати', exact: true }).click()
  await planningPanel.getByLabel('Коли').selectOption('BEFORE_DUE')
  await planningPanel.getByLabel('За скільки хвилин').fill('45')
  await planningPanel.locator('.task-create-switch input[type="checkbox"]').check()
  await planningPanel.getByLabel('Максимум екземплярів').fill('3')

  await relationsToggle.click()
  const relationsPanel = dialog.locator('#task-create-relations-panel')
  await relationsPanel.getByRole('combobox', { name: /^Завдання/ }).selectOption('tsk_design')
  await relationsPanel.getByRole('button', { name: 'Додати зв’язок' }).click()
  await expect(relationsPanel.getByText(/TSK-2401 · Підготувати концепцію дизайну dashboard/)).toBeVisible()

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

test('optional options failures stay local and do not block basic task creation', async ({ page }, testInfo) => {
  await login(page)
  await page.route('**/api/v1/tasks/options?**', async (route) => {
    await route.fulfill({
      status: 503,
      contentType: 'application/problem+json',
      body: JSON.stringify({ title: 'Options unavailable', status: 503 }),
    })
  })
  await page.goto('/tasks/new')

  const dialog = page.getByRole('dialog', { name: 'Нове завдання' })
  const title = `E2E без довідників · ${testInfo.project.name} · ${Date.now()}`
  await page.getByLabel('Назва завдання').fill(title)

  await expect(dialog.getByText('Список людей недоступний. Поточних відповідальних збережено.')).toBeVisible()

  await dialog.getByRole('button', { name: /^Контекст і матеріали/ }).click()
  await expect(dialog.getByText('Не вдалося завантажити проєкти й завдання.')).toBeVisible()
  await expect(dialog.getByText('Не вдалося завантажити теги.')).toBeVisible()

  await dialog.getByRole('button', { name: /^Учасники/ }).click()
  await expect(dialog.getByText(/Не вдалося завантажити постановника й інших учасників/)).toBeVisible()

  await dialog.getByRole('button', { name: /^Планування/ }).click()
  await expect(dialog.getByText(/Не вдалося завантажити дані для планування/)).toBeVisible()

  await dialog.getByRole('button', { name: /^Зв’язки/ }).click()
  await expect(dialog.getByText(/Не вдалося завантажити доступні завдання і зв’язки/)).toBeVisible()
  await expect(page.getByLabel('Назва завдання')).toHaveValue(title)

  const createRequestPromise = page.waitForRequest(
    (request) => request.method() === 'POST' && new URL(request.url()).pathname === '/api/v1/tasks',
  )
  await dialog.getByRole('button', { name: 'Створити завдання' }).click()
  const createRequest = await createRequestPromise
  const payload = createRequest.postDataJSON() as CreateTaskInput
  expect(payload).toMatchObject({
    title,
    projectId: null,
    tagIds: [],
    relations: [],
    reminders: [],
    recurrence: null,
    attachmentIds: [],
  })
  expect(payload.participants).toEqual([
    { userId: 'usr_maria', role: 'RESPONSIBLE' },
  ])
  await expect(page).toHaveURL(/\/tasks\/tsk_/)
})

test('autosave reports a local failure and retries without announcing every success', async ({ page }) => {
  await login(page)
  await page.goto('/tasks/new')
  const dialog = page.getByRole('dialog', { name: 'Нове завдання' })

  await page.evaluate(() => {
    const original = Storage.prototype.setItem
    Object.defineProperty(window, '__taskDraftOriginalSetItem', {
      configurable: true,
      value: original,
    })
    Storage.prototype.setItem = function setItem(key: string, value: string) {
      if (key.startsWith('bertcrm:task-create:')) throw new Error('Simulated quota error')
      return original.call(this, key, value)
    }
  })

  await page.getByLabel('Назва завдання').fill('Перевірка помилки автозбереження')
  await expect(dialog.getByRole('alert').filter({ hasText: 'Не вдалося зберегти' })).toBeVisible()

  await page.evaluate(() => {
    const original = (window as typeof window & {
      __taskDraftOriginalSetItem: typeof Storage.prototype.setItem
    }).__taskDraftOriginalSetItem
    Storage.prototype.setItem = original
  })
  await dialog.getByRole('button', { name: 'Повторити' }).first().click()
  const savedStatus = dialog.getByText('Збережено', { exact: true })
  await expect(savedStatus).toBeVisible()
  await expect(savedStatus).not.toHaveAttribute('role')
})
