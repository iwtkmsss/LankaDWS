import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import type { CreateTaskInput } from '@lankadws/contracts'

async function login(page: Page) {
  await page.goto('/login')
  await page.getByLabel('Нікнейм').fill('maria')
  await page.getByLabel('Пароль', { exact: true }).fill('LankaDWSDemoPassphrase2026!')
  await page.getByRole('button', { name: 'Увійти' }).click()
  await expect(page).toHaveURL(/\/feed$/)
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
  expect(Math.abs((fixedRowsAfter[0]?.y ?? 0) - (fixedRowsBefore[0]?.y ?? 0))).toBeLessThan(0.5)
  expect(Math.abs((fixedRowsAfter[1]?.y ?? 0) - (fixedRowsBefore[1]?.y ?? 0))).toBeLessThan(0.5)

  const createButton = dialog.getByRole('button', { name: 'Створити завдання' })
  await createButton.focus()
  await page.keyboard.press('Tab')
  await expect(dialog.getByRole('button', { name: 'Закрити' })).toBeFocused()

  await page.getByLabel('Назва завдання').fill(`Незавершена форма · ${testInfo.project.name}`)
  await page.keyboard.press('Escape')
  const confirmation = page.getByRole('alertdialog', { name: 'Закрити форму?' })
  await expect(confirmation).toBeVisible()
  await expect(dialog.locator('..')).not.toHaveClass(/is-closing/)
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

  await page.locator('.sidebar .nav-section a[href="/feed"]').evaluate((element) => {
    (element as HTMLElement).click()
  })
  await expect(confirmation).toBeVisible()
  await expect(page).toHaveURL(/\/tasks\/new$/)
  await confirmation.getByRole('button', { name: 'Зберегти чернетку і закрити' }).click()
  await expect(page).toHaveURL(/\/feed$/)
  await expect.poll(() => page.evaluate(() => document.body.style.position)).toBe('')

  await page.goto('/tasks/new')
  const restoredNotice = page.getByRole('status').filter({ hasText: 'Чернетку відновлено.' })
  await expect(restoredNotice).toBeVisible()
  await expect(restoredNotice).toHaveCSS('font-size', '10px')
  await expect(restoredNotice.getByRole('button', { name: 'Гаразд' })).toBeVisible()
})

test('creates a task through the complete modal workflow', async ({ page }, testInfo) => {
  await login(page)
  await page.goto('/tasks/new')

  const dialog = page.getByRole('dialog', { name: 'Нове завдання' })
  await expect(dialog).toBeVisible()
  await expect(page.getByLabel('Назва завдання')).toBeFocused()
  await expect(page.evaluate(() => document.body.style.overflow)).resolves.toBe('hidden')

  const planningToggle = dialog.getByRole('button', { name: /^Планування/ })
  const checklistToggle = dialog.getByRole('button', { name: /^Чек-ліст/ })
  const relationsToggle = dialog.getByRole('button', { name: /^Зв’язки/ })
  await expect(planningToggle).toHaveAttribute('aria-expanded', 'false')
  await expect(checklistToggle).toHaveAttribute('aria-expanded', 'false')
  await expect(relationsToggle).toHaveAttribute('aria-expanded', 'false')
  await expect(dialog.locator('.task-create-role-card')).toHaveCount(4)
  expect(await dialog.locator('.task-create-core, .task-create-primary-participants, .task-create-details').evaluateAll(
    (elements) => elements.map((element) => element.className),
  )).toEqual(['task-create-core', 'task-create-primary-participants', 'task-create-details'])
  expect(await dialog.locator('.task-create-disclosure__copy strong').allTextContents()).toEqual([
    'Планування',
    'Чек-ліст',
    'Зв’язки',
  ])
  const initialStart = await page.getByLabel('Дата початку').inputValue()
  const initialDue = await page.getByLabel('Кінцевий термін').inputValue()
  expect(new Date(initialDue).getTime() - new Date(initialStart).getTime()).toBe(60 * 60 * 1_000)

  const title = `E2E створення · ${testInfo.project.name} · ${Date.now()}`
  await page.getByLabel('Назва завдання').fill(title)
  await page.getByLabel('Опис').fill('Перевірка повної форми створення завдання.')
  await dialog.getByLabel('Пріоритет').selectOption('URGENT')
  await page.getByLabel('Дата початку').fill(futureLocalDateTime(2))
  await page.getByLabel('Кінцевий термін').fill(futureLocalDateTime(4))

  const attachmentName = `task-create-${testInfo.project.name}.txt`
  await dialog.locator('input[type="file"]').setInputFiles({
    name: attachmentName,
    mimeType: 'text/plain',
    buffer: Buffer.from('Task creation modal E2E attachment'),
  })
  await expect(dialog.locator('.task-create-attachments li').filter({ hasText: attachmentName })).toBeVisible()

  const responsibleSearch = dialog.getByRole('combobox', { name: 'Додати: відповідальний' })
  await responsibleSearch.fill('Андр')
  await dialog.getByRole('option', { name: /Андрій Коваль/ }).click()
  const collaboratorSearch = dialog.getByRole('combobox', { name: 'Додати: співвиконавець' })
  await collaboratorSearch.fill('Оле')
  await dialog.getByRole('option', { name: /Олена Бондар/ }).click()

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
  const relationCombobox = relationsPanel.getByRole('combobox', { name: 'Пошук батьківського завдання' })
  await relationCombobox.fill('dashboard')
  await relationsPanel.getByRole('option', { name: /2401.*Підготувати концепцію дизайну dashboard/ }).click()
  const hierarchy = relationsPanel.getByRole('tree', { name: 'Структура батьківського завдання' })
  await expect(hierarchy).toBeVisible()
  await hierarchy.getByRole('button', {
    name: /Прив’язати нове завдання до 2401.*Підготувати концепцію дизайну dashboard/,
  }).click()
  await expect(hierarchy.getByRole('button', { name: /Прив’язати нове завдання до 2401/ })).toHaveAttribute('aria-pressed', 'true')

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
    parentTaskId: 'tsk_design',
    reporterId: 'usr_maria',
    priority: 'URGENT',
    estimatedMinutes: 120,
    tagIds: [],
    checklistItems: [expect.objectContaining({ title: 'Перевірити результат', isCompleted: false })],
    relations: [],
    reminders: [
      {
        target: { type: 'PARTICIPANTS' },
        trigger: { type: 'BEFORE_DUE', offsetMinutes: 45 },
      },
    ],
    recurrence: null,
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
  const detailPage = page
  await expect(detailPage.getByRole('heading', { name: title })).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.evaluate(() => document.body.style.overflow)).resolves.toBe('')
  await detailPage.getByRole('button', { name: 'До списку' }).click()
  await expect(page).toHaveURL(/\/tasks$/)
})

test('opens a task as a standalone page without fetching the task list', async ({ page }) => {
  await login(page)
  const listRequests: string[] = []
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (request.method() === 'GET' && url.pathname === '/api/v1/tasks') listRequests.push(url.toString())
  })

  await page.goto('/tasks/tsk_design?role=CREATOR&search=dashboard')

  await expect(page.getByRole('heading', { name: 'Підготувати концепцію дизайну dashboard' })).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.locator('.task-detail-page')).toHaveCount(1)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  expect(listRequests).toEqual([])

  await page.getByRole('button', { name: 'До списку' }).click()
  await expect(page).toHaveURL(/\/tasks\?role=CREATOR&search=dashboard$/)
})

test('sends a selected task comment mention as structured data', async ({ page }) => {
  await login(page)
  await page.goto('/tasks/tsk_design')

  await page.getByRole('button', { name: 'Розгорнути секцію «Обговорення»' }).click()
  const discussion = page.locator('.task-discussion')
  const comment = discussion.getByRole('textbox', { name: 'Коментар до завдання' })
  await comment.fill('@оле')
  await page.getByRole('listbox', { name: 'Коментар до завдання: варіанти згадок' })
    .getByRole('option', { name: /Олена Бондар/ })
    .click()
  await comment.pressSequentially(', перевір, будь ласка.')

  const requestPromise = page.waitForRequest((request) => (
    request.method() === 'POST'
    && new URL(request.url()).pathname === '/api/v1/tasks/tsk_design/comments'
  ))
  await discussion.getByRole('button', { name: /Надіслати/ }).click()
  const request = await requestPromise
  expect(request.headers()['idempotency-key']).toMatch(/^task-comment:/)
  expect(request.postDataJSON()).toMatchObject({
    body: '@Олена Бондар, перевір, будь ласка.',
    mentions: [{
      userId: 'usr_olena',
      start: 0,
      end: 13,
      label: 'Олена Бондар',
    }],
  })

  await expect(page.getByRole('link', { name: '@Олена Бондар' }).last()).toBeVisible()
  await page.getByRole('button', { name: 'Розгорнути секцію «Учасники»' }).click()
  await expect(page.locator('.task-role-group').filter({ hasText: 'Олена Бондар' })).toBeVisible()
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

  await expect(dialog.getByText(/Не вдалося завантажити учасників/)).toBeVisible()

  await dialog.getByRole('button', { name: /^Зв’язки/ }).click()
  await expect(dialog.getByText('Знайдіть завдання, щоб відкрити його структуру.')).toBeVisible()

  await dialog.getByRole('button', { name: /^Планування/ }).click()
  await expect(dialog.getByText(/Не вдалося завантажити дані для планування/)).toBeVisible()
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
      if (key.startsWith('lankadws:task-create:')) throw new Error('Simulated quota error')
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
