import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

async function login(page: Page, username = 'maria') {
  await page.goto('/login')
  await page.getByLabel('Нікнейм').fill(username)
  await page.getByLabel('Пароль', { exact: true }).fill('BertDemoPassphrase2026!')
  await page.getByRole('button', { name: 'Увійти' }).click()
  await expect(page).toHaveURL(/\/feed$/)
}

test('desktop navigation prefetches destinations and reuses cached task data', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile-chromium', 'Desktop sidebar is the navigation prefetch surface.')
  await page.setViewportSize({ width: 1440, height: 900 })
  await login(page)
  const sidebar = page.locator('.sidebar')
  let taskListRequests = 0
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/v1/tasks') taskListRequests += 1
  })

  async function navigateTo(path: string, heading: string) {
    const link = sidebar.locator(`a[href="${path}"]`)
    await link.hover()
    await link.click()
    await expect(page).toHaveURL(new RegExp(`${path.replace('/', '\\/')}$`))
    await expect(link).toHaveClass(/active/)
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible()
  }

  await navigateTo('/tasks', 'Завдання')
  const taskLink = page.locator('.task-list-table tbody a').first()
  await expect(taskLink).toBeVisible()
  await taskLink.click()
  await expect(page).toHaveURL(/\/tasks\/tsk_/)
  await expect(page.locator('.task-detail-heading h2')).toBeVisible()
  const taskRequestsAfterFirstVisit = taskListRequests

  await navigateTo('/messages', 'Повідомлення')
  await navigateTo('/drive', 'Диск')
  await navigateTo('/calendar', 'Календар')
  await navigateTo('/employees', 'Працівники')
  await navigateTo('/overview', 'Огляд')
  await navigateTo('/feed', 'Жива стрічка')
  await navigateTo('/tasks', 'Завдання')
  await expect(page.locator('.page-data-loader')).toHaveCount(0)
  await page.waitForTimeout(250)
  expect(taskListRequests).toBe(taskRequestsAfterFirstVisit)
})

test('home landing follows FEED capability while explicit overview stays addressable', async ({ page, request }) => {
  await login(page)
  await expect(page.getByRole('heading', { name: 'Жива стрічка', exact: true })).toBeVisible()
  await page.goto('/')
  await expect(page).toHaveURL(/\/feed$/)
  await page.goto('/overview')
  await expect(page).toHaveURL(/\/overview$/)

  const adminLogin = await request.post('/api/v1/auth/login', {
    data: { username: 'dmytro', password: 'BertDemoPassphrase2026!' },
  })
  expect(adminLogin.ok()).toBeTruthy()
  const csrfToken = (await adminLogin.json() as { csrfToken: string }).csrfToken
  const capabilities = await request.get('/api/v1/admin/organization/capabilities')
  const feed = (await capabilities.json() as { items: Array<{ code: string; enabled: boolean; version: number }> }).items
    .find((capability) => capability.code === 'FEED')
  expect(feed).toBeDefined()

  await request.patch('/api/v1/admin/organization/capabilities/FEED', {
    data: { enabled: false, expectedVersion: feed!.version },
    headers: { 'x-csrf-token': csrfToken },
  })

  try {
    await page.context().clearCookies()
    await page.goto('/login')
    await page.getByLabel('Нікнейм').fill('maria')
    await page.getByLabel('Пароль', { exact: true }).fill('BertDemoPassphrase2026!')
    await page.getByRole('button', { name: 'Увійти' }).click()
    await expect(page).toHaveURL(/\/overview$/)
  } finally {
    await request.patch('/api/v1/admin/organization/capabilities/FEED', {
      data: { enabled: feed!.enabled, expectedVersion: feed!.version + 1 },
      headers: { 'x-csrf-token': csrfToken },
    })
  }
})

async function createTaskThroughModal(
  page: Page,
  title: string,
  options: { description?: string; additionalResponsible?: string } = {},
) {
  await page.goto('/tasks/new')
  const dialog = page.getByRole('dialog', { name: 'Нове завдання' })
  await expect(dialog).toBeVisible()
  await page.getByLabel('Назва завдання').fill(title)
  if (options.description) await page.getByLabel('Опис').fill(options.description)
  if (options.additionalResponsible) {
    const responsibleSelect = page.getByLabel('Додати відповідального')
    const responsibleId = await responsibleSelect.locator('option').filter({
      hasText: options.additionalResponsible,
    }).getAttribute('value')
    expect(responsibleId).toBeTruthy()
    await responsibleSelect.selectOption(responsibleId!)
  }
  await page.getByRole('button', { name: 'Створити завдання' }).click()
  await expect(page).toHaveURL(/\/tasks\/tsk_/)
  await expect(page.getByRole('heading', { name: title })).toBeVisible()
}

test('employee feed and canonical navigation are accessible', async ({ page }) => {
  await login(page)
  await page.goto('/feed')
  await expect(page.getByRole('heading', { name: 'Жива стрічка', exact: true })).toBeVisible()
  await expect(page.locator('.sidebar .nav-section__label').getByText('Адміністрування', { exact: true })).toHaveCount(0)
  await expect(page.locator('.feed-card').getByText('Марія Іваненко').first()).toBeVisible()
  await expect(page.locator('.feed-attention').getByRole('link').first()).toHaveAttribute(
    'href',
    '/feed?filter=ACK_REQUIRED',
  )
  const eventSource = page.locator('.feed-source-card').filter({ hasText: 'Огляд операцій' })
  await expect(eventSource).toBeVisible()
  await eventSource.getByRole('link', { name: 'Відкрити подію' }).click()
  const eventDialog = page.getByRole('dialog', { name: 'Подія' })
  await expect(eventDialog.getByRole('heading', { name: 'Огляд операцій' })).toBeVisible()
  await eventDialog.getByRole('button', { name: 'Закрити' }).click()
  await expect(page.getByRole('heading', { name: 'Календар', exact: true })).toBeVisible()
  await page.goto('/feed?type=EVENT')
  await expect(page).toHaveURL(/\/feed\?type=EVENT$/)
  await expect(page.locator('.feed-source-card').filter({ hasText: 'Огляд операцій' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Показати всю стрічку' })).toHaveCount(1)
  await expect(page.getByRole('tab')).toHaveCount(0)
  await expect(page.getByLabel('Тип події')).toHaveCount(0)
  await expect(page.getByLabel('Збережені фільтри')).toHaveCount(0)
  await page.getByRole('button', { name: 'Показати всю стрічку' }).click()
  await expect(page).toHaveURL(/\/feed$/)
  const overviewA11y = await new AxeBuilder({ page }).analyze()
  expect(overviewA11y.violations).toEqual([])
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
})

test('manager overview and admin access stay correctly scoped', async ({ page }) => {
  await login(page, 'andrii')
  await page.goto('/overview?company=cmp_bert_service')
  await expect(page.getByRole('heading', { name: 'Огляд', exact: true })).toBeVisible()
  await expect(page).not.toHaveURL(/company=/)
  await expect(page.getByText('Потребують рішення')).toHaveCount(0)
  await page.goto('/admin/users')
  await expect(page.getByRole('heading', { name: 'У вас немає доступу' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Користувачі' })).toHaveCount(0)
})

test('organization tree expands and keeps the selected unit addressable', async ({ page }) => {
  await login(page, 'maria')
  await page.goto('/employees/org')
  const tree = page.getByRole('tree', { name: 'Структура підрозділів' })
  await expect(tree).toBeVisible()

  const expandable = tree.locator('[role="treeitem"][aria-expanded]').first()
  await expect(expandable).toHaveAttribute('aria-expanded', 'true')
  const toggle = expandable.getByRole('button', { name: /Згорнути/ })
  await toggle.click()
  await expect(expandable).toHaveAttribute('aria-expanded', 'false')
  await expandable.getByRole('button', { name: /Розгорнути/ }).click()

  const selectedUnit = tree.locator('.org-tree__select').first()
  await selectedUnit.click()
  await expect(page).toHaveURL(/\/employees\/org\?unit=/)
  await selectedUnit.press('ArrowDown')
  await expect(tree.locator('.org-tree__select').nth(1)).toBeFocused()
})

test('command palette keeps canonical create actions ahead of results', async ({ page }) => {
  await login(page, 'maria')
  await page.getByRole('button', { name: 'Пошук у BERT CRM' }).click()
  const palette = page.getByRole('dialog', { name: 'Глобальний пошук' })
  await palette.getByRole('textbox').fill('Ｍ')
  await expect(palette.getByRole('option', { name: /Марія Іваненко.*@maria/ })).toBeVisible()
  await expect(palette.locator('.palette__group')).toHaveText(['Працівники'])

  await palette.getByRole('textbox').fill('TSK-2401')
  await expect(palette.getByRole('option', { name: /Підготувати концепцію дизайну dashboard.*№2401/ })).toBeVisible()
  await expect(palette.locator('.palette__group')).toHaveText(['Завдання'])

  await palette.getByRole('textbox').fill('завдання')
  await expect(palette.getByText('Створити', { exact: true })).toBeVisible()
  await palette.getByRole('option', { name: /Нове завдання/ }).click()
  await expect(page).toHaveURL(/\/tasks\/new/)
})

test('employee directory and profile show only the immediate org parent path', async ({ page }) => {
  await login(page, 'maria')
  await page.goto('/employees?q=Марія')
  await expect(page.locator('.employee-org')).toHaveText(/Операції → Продукт і дизайн/)
  await page.getByRole('link', { name: /Марія Іваненко/ }).click()
  await expect(page.locator('.employee-hierarchy')).toHaveText(/Операції → Продукт і дизайн/)
})

test('feed publishing, acknowledgement and comments remain explicit', async ({ page }, testInfo) => {
  await login(page, testInfo.project.name === 'mobile-chromium' ? 'olena' : 'maria')
  await page.goto('/feed')
  const composerTrigger = page.getByRole('button', { name: 'Створити публікацію' })
  await composerTrigger.click()
  const composer = page.getByRole('dialog', { name: 'Створити публікацію' })
  const postText = `Перевірка зручності стрічки · ${testInfo.project.name} · ${Date.now()}`
  await composer.getByLabel('Текст публікації').fill(postText)
  await composer.getByLabel('Додати файл').setInputFiles({
    name: `feed-${testInfo.project.name}.txt`,
    mimeType: 'text/plain',
    buffer: Buffer.from('Вкладення стрічки'),
  })
  await expect(composer.getByText(`feed-${testInfo.project.name}.txt`)).toBeVisible()
  await composer.getByRole('button', { name: 'Опублікувати', exact: true }).click()
  await expect(composer).toHaveCount(0)
  await expect(composerTrigger).toBeFocused()
  const card = page.locator('.feed-card').filter({ hasText: postText })
  await expect(card).toBeVisible()
  await card.getByRole('button', { name: 'Стежу', exact: true }).click()
  await card.getByRole('menuitemradio', { name: 'Без сповіщень' }).click()
  await expect(card.getByRole('button', { name: 'Стежити', exact: true })).toBeVisible()
  await card.getByRole('button', { name: 'Стежити', exact: true }).click()
  await card.getByRole('menuitemradio', { name: 'Лише згадки' }).click()
  await expect(card.getByRole('button', { name: 'Лише згадки', exact: true })).toBeVisible()
  await page.goto('/feed?filter=FOLLOWING')
  await expect(page).toHaveURL(/filter=FOLLOWING/)
  await expect(card).toBeVisible()
  await page.getByRole('button', { name: 'Показати всю стрічку' }).click()
  await card.getByRole('button', { name: 'Додати в обране' }).click()
  await expect(card.getByRole('button', { name: 'Прибрати з обраного' })).toBeVisible()
  await page.goto('/feed?favorite=true')
  const favoriteCard = page.locator('.feed-card').filter({ hasText: postText })
  await expect(favoriteCard).toBeVisible()
  await favoriteCard.getByRole('button', { name: 'Прибрати з обраного' }).click()
  await expect(favoriteCard).not.toBeVisible()
  await page.goto('/feed')
  await expect(card).toBeVisible()
  await expect(card.getByText('Перевіряється перед завантаженням')).toBeVisible()
  await card.getByRole('button', { name: 'Подобається' }).click()
  await expect(card.getByRole('button', { name: /Подобається · 1/ })).toBeVisible()
  await card.getByRole('button', { name: 'Коментарі' }).click()
  await card.getByLabel('Новий коментар').fill('Контекст додано окремим коментарем.')
  await card.getByRole('button', { name: 'Надіслати' }).click()
  await expect(card.getByText('Контекст додано окремим коментарем.')).toBeVisible()

  const acknowledgementCard = page.locator('.feed-card').filter({ hasText: 'Сьогодні оновили робочий простір' })
  const acknowledgementButton = acknowledgementCard.getByRole('button', { name: 'Підтвердити' })
  if (await acknowledgementButton.isVisible()) await acknowledgementButton.click()
  await expect(acknowledgementCard.getByText('Ви підтвердили ознайомлення')).toBeVisible()
  const feedA11y = await new AxeBuilder({ page }).analyze()
  expect(feedA11y.violations).toEqual([])
})

test('task detail creates a real subtask and explains why the parent cannot finish early', async ({ page }, testInfo) => {
  test.setTimeout(90_000)
  const isMobile = testInfo.project.name === 'mobile-chromium'
  const username = isMobile ? 'olena' : 'maria'
  const assigneeId = isMobile ? 'usr_olena' : 'usr_maria'
  const parentTitle = `Підготувати запуск · ${testInfo.project.name}`
  const subtaskTitle = `Перевірити результат · ${testInfo.project.name}`
  await login(page, username)
  await createTaskThroughModal(page, parentTitle, {
    description: 'Один зрозумілий результат із окремою відповідальною підзадачею.',
  })

  await page.getByRole('button', { name: 'Додати підзадачу' }).click()
  const subtaskForm = page.locator('.task-subtask-form')
  await subtaskForm.getByPlaceholder('Який окремий результат потрібен?').fill(subtaskTitle)
  await subtaskForm.getByLabel('Виконавець').selectOption(assigneeId)
  await subtaskForm.getByLabel('Опис').fill('Це повне завдання зі своїм статусом, а не пункт checklist.')
  await subtaskForm.getByRole('button', { name: 'Створити підзадачу' }).click()
  await expect(page.getByText('0 із 1 завершено')).toBeVisible()
  await expect(page.locator('.task-subtask-list').getByText(subtaskTitle)).toBeVisible()

  await page.getByLabel('Змінити статус').selectOption('DONE')
  const blocker = page.getByRole('alert').filter({ hasText: 'Завдання ще не готове до завершення' })
  await expect(blocker).toBeVisible()
  await expect(blocker.getByRole('link', { name: subtaskTitle })).toBeVisible()

  await page.locator('.task-subtask-list').getByRole('link', { name: new RegExp(subtaskTitle) }).click()
  await expect(page.getByRole('heading', { name: subtaskTitle })).toBeVisible()
  await expect(page.getByRole('link', { name: /До батьківського завдання/ })).toBeVisible()
  await page.getByLabel('Змінити статус').selectOption('DONE')
  await expect(page.getByLabel('Змінити статус')).toHaveValue('DONE')

  await page.getByRole('link', { name: /До батьківського завдання/ }).click()
  await expect(page.getByRole('heading', { name: parentTitle })).toBeVisible()
  await expect(page.getByText('1 із 1 завершено')).toBeVisible()
  await page.getByLabel('Змінити статус').selectOption('DONE')
  await expect(page.getByLabel('Змінити статус')).toHaveValue('DONE')

  await page.getByRole('button', { name: 'Розгорнути секцію «Матеріали»' }).click()
  const materials = page.locator('.task-materials')
  const fileName = `task-material-${testInfo.project.name}.txt`
  await materials.getByLabel(/Додати файл/).setInputFiles({
    name: fileName,
    mimeType: 'text/plain',
    buffer: Buffer.from('Контекст завдання'),
  })
  await expect(materials.getByText(fileName)).toBeVisible()
  const discussion = page.locator('.task-discussion')
  await discussion.getByLabel('Додати файл із матеріалів').selectOption({ label: fileName })
  await discussion.getByPlaceholder('Додати корисний коментар…').fill('Матеріал додано до рішення.')
  await discussion.getByRole('button', { name: 'Надіслати' }).click()
  await expect(discussion.getByText('Матеріал додано до рішення.')).toBeVisible()
  await discussion.getByRole('button', { name: 'Відповісти' }).click()
  await expect(discussion.getByText(/Відповідь для/)).toBeVisible()
  await discussion.getByPlaceholder('Напишіть коротку відповідь…').fill('Перевірено, продовжуємо.')
  await discussion.getByRole('button', { name: 'Надіслати' }).click()
  await expect(discussion.getByText('Перевірено, продовжуємо.')).toBeVisible()
  const taskA11y = await new AxeBuilder({ page }).analyze()
  expect(taskA11y.violations).toEqual([])
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
})

test('task role views explain why a task is visible and participant management stays compact', async ({ page }, testInfo) => {
  test.setTimeout(90_000)
  await login(page)
  await page.goto('/tasks?company=cmp_bert_ua')
  await expect(page.getByRole('tab', { name: /Мої/ })).toBeVisible()
  await expect(page.getByRole('tab', { name: /Допомагаю/ })).toBeVisible()
  await expect(page.getByRole('tab', { name: /Доручив/ })).toBeVisible()
  await expect(page.getByRole('tab', { name: /Спостерігаю/ })).toBeVisible()
  await expect(page.getByRole('link', { name: /Підготувати концепцію дизайну dashboard/ })).toBeVisible()

  await page.getByRole('tab', { name: /Допомагаю/ }).click()
  await expect(page).toHaveURL(/role=CO_EXECUTOR/)
  await expect(page.getByRole('link', { name: /Підготувати звіт за липень/ })).toBeVisible()
  await page.getByRole('tab', { name: /Доручив/ }).click()
  await expect(page).toHaveURL(/role=CREATOR/)
  await expect(page.getByRole('link', { name: /Оновити UI-kit компонента/ })).toBeVisible()
  await page.getByRole('tab', { name: /Спостерігаю/ }).click()
  await expect(page).toHaveURL(/role=OBSERVER/)
  await page.getByRole('link', { name: /Підготувати доступи нового працівника/ }).click()
  await expect(page.getByRole('heading', { name: 'Учасники' })).toBeVisible()
  await expect(page.getByText('Спостерігачі', { exact: true })).toBeVisible()
  await expect(page.getByLabel('Змінити статус')).toHaveCount(0)

  const title = `Перевірити керування учасниками · ${testInfo.project.name}`
  await createTaskThroughModal(page, title, { additionalResponsible: 'Андрій Коваль' })
  await page.getByRole('button', { name: 'Керувати' }).click()
  const participantSection = page.locator('.task-participants')
  const participantId = 'usr_marko'
  const participantName = 'Марко Литвин'
  await participantSection.getByLabel('Людина').selectOption(participantId)
  await participantSection.getByLabel('Роль у завданні').selectOption('OBSERVER')
  await participantSection.getByRole('button', { name: 'Додати учасника' }).click()
  await expect(participantSection.getByText('Учасника додано.')).toBeVisible()
  const participantChip = participantSection.locator('.task-role-people strong', { hasText: participantName })
  await expect(participantChip).toBeVisible()
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  await page.screenshot({
    path: `artifacts/screenshots/${testInfo.project.name}-task-roles.png`,
    fullPage: true,
  })
  await participantSection
    .getByRole('button', { name: new RegExp(`Вилучити ${participantName}`) })
    .click()
  await expect(participantSection.getByText('Учасника вилучено.')).toBeVisible()
  await expect(participantChip).toHaveCount(0)
})

test('task approval completes through the standalone detail for requester and approver', async ({ page }, testInfo) => {
  await login(page, 'maria')
  const title = `Погодження інтеграції · ${testInfo.project.name} · ${Date.now()}`
  await createTaskThroughModal(page, title)
  const taskUrl = page.url()
  const approval = page.getByRole('region', { name: 'Погодження' })

  await approval.getByLabel('Approver завдання').selectOption('usr_dmytro')
  await approval.getByRole('button', { name: 'Запросити погодження' }).click()
  await expect(approval.getByText('Запит на погодження надіслано.')).toBeVisible()
  await expect(approval.getByText(/Очікуємо рішення від/)).toBeVisible()

  await page.context().clearCookies()
  await login(page, 'dmytro')
  await page.goto(taskUrl)
  const approverView = page.getByRole('region', { name: 'Погодження' })
  await approverView.getByLabel('Коментар до рішення (необов’язково)').fill('Перевірено в інтеграційному E2E.')
  await approverView.getByRole('button', { name: 'Погодити' }).click()

  await expect(approverView.getByText('Завдання погоджено й завершено.')).toBeVisible()
  await expect(page.getByLabel('Змінити статус')).toHaveValue('DONE')
  await expect(approverView.getByText(/Історія погоджень · 1/)).toBeVisible()
})

test('task list column customization persists and resets', async ({ page }, testInfo) => {
  await login(page, 'maria')
  await page.goto('/tasks')
  const columns = page.locator('details.task-list-columns')

  await columns.locator('summary').click()
  await columns.getByLabel('Пріоритет').click()
  await expect(columns.getByLabel('Пріоритет')).toBeChecked()
  if (testInfo.project.name === 'mobile-chromium') {
    await expect(page.locator('td[data-label="Пріоритет"]').first()).toBeVisible()
  } else {
    await expect(page.getByRole('columnheader', { name: 'Пріоритет' })).toBeVisible()
  }
  await expect(columns.getByRole('button', { name: 'За замовчуванням' })).toBeEnabled()

  await page.reload()
  await columns.locator('summary').click()
  await expect(columns.getByLabel('Пріоритет')).toBeChecked()

  await columns.getByRole('button', { name: 'За замовчуванням' }).click()
  await expect(page.locator('th, td').filter({ hasText: /^Пріоритет$/ })).toHaveCount(0)
})

test('standalone file sharing is explicit, scanner-aware and revocable', async ({ page }, testInfo) => {
  await login(page, 'maria')
  await page.goto('/feed')
  await page.getByRole('button', { name: 'Створити публікацію' }).click()
  const composer = page.getByRole('dialog', { name: 'Створити публікацію' })
  const fileName = `standalone-${testInfo.project.name}.txt`
  await composer.getByLabel('Поширити файл').setInputFiles({
    name: fileName,
    mimeType: 'text/plain',
    buffer: Buffer.from('Окремо поширений файл у стрічці'),
  })
  await expect(composer.getByText('Файл поширено. Завантаження відкриється після безпечної перевірки.')).toBeVisible()
  await composer.getByRole('button', { name: 'Закрити' }).click()
  const card = page.locator('.feed-source-card').filter({ hasText: fileName })
  await expect(card).toBeVisible()
  await expect(card.getByText('Перевіряється', { exact: true })).toBeVisible()
  await page.goto('/feed?type=FILE')
  await expect(page).toHaveURL(/type=FILE/)
  await expect(card).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
  await page.screenshot({
    path: `artifacts/screenshots/${testInfo.project.name}-feed-file-share.png`,
    fullPage: true,
  })
  await card.getByRole('button', { name: 'Прибрати', exact: true }).click()
  await card.getByRole('button', { name: 'Підтвердити', exact: true }).click()
  await expect(card).not.toBeVisible()
})

test('administrator sees the approved grouped admin navigation', async ({ page }, testInfo) => {
  if (testInfo.project.name === 'desktop-chromium') {
    await page.setViewportSize({ width: 1440, height: 900 })
  }
  await login(page, 'dmytro')
  await page.goto('/admin')
  await expect(page.getByRole('heading', { name: 'Адміністрування', exact: true })).toBeVisible()
  if (testInfo.project.name === 'mobile-chromium') {
    await page.getByRole('button', { name: 'Відкрити меню' }).click()
    const sidebar = page.locator('.sidebar')
    await expect(sidebar.getByRole('link', { name: 'Компанії', exact: true })).toBeVisible()
    await expect(sidebar.getByRole('link', { name: 'Користувачі', exact: true })).toBeVisible()
  } else {
    await page.locator('.sidebar').getByRole('button', { name: 'Ще' }).click()
    const overflowMenu = page.getByRole('menu', { name: 'Додаткові розділи' })
    await expect(overflowMenu.getByRole('menuitem', { name: 'Компанії', exact: true })).toBeVisible()
    await expect(overflowMenu.getByRole('menuitem', { name: 'Користувачі', exact: true })).toBeVisible()
  }
  await page.screenshot({ path: `artifacts/screenshots/${testInfo.project.name}-admin.png`, fullPage: true })
})

test('desktop sidebar groups routes, persists collapse and keeps active navigation visible', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile-chromium', 'Desktop collapse is independent from mobile navigation.')
  await page.setViewportSize({ width: 1440, height: 900 })
  await login(page, 'dmytro')
  const sidebar = page.locator('.sidebar')
  await expect(sidebar.getByText('Щоденна робота', { exact: true })).toBeVisible()
  await expect(sidebar.getByText('Комунікації', { exact: true })).toBeVisible()
  await expect(sidebar.locator('.nav-section').first().getByRole('link')).toHaveText([
    'Жива стрічка', 'Завдання', 'Чат', 'Диск', 'Календар', 'Працівники', 'Огляд',
  ])
  const moreButton = sidebar.getByRole('button', { name: 'Ще' })
  await expect(moreButton).toBeVisible()
  await moreButton.click()
  const overflowMenu = page.getByRole('menu', { name: 'Додаткові розділи' })
  await expect(
    overflowMenu.locator('.nav-section__label').getByText('Адміністрування', { exact: true }),
  ).toBeVisible()
  await moreButton.click()

  await sidebar.getByRole('link', { name: 'Жива стрічка', exact: true }).click()
  const feedLink = sidebar.getByRole('link', { name: 'Жива стрічка', exact: true })
  await expect(page).toHaveURL(/\/feed$/)
  await expect(feedLink).toHaveClass(/active/)

  await page.getByRole('button', { name: 'Згорнути бічну панель' }).click()
  await expect(page.getByRole('button', { name: 'Розгорнути бічну панель' })).toBeVisible()
  await expect(feedLink).toHaveAttribute('title', 'Жива стрічка')
  await expect.poll(() => page.evaluate(() =>
    window.localStorage.getItem('bertcrm.sidebar.collapsed'))).toBe('true')
  await page.reload()
  await expect(page.getByRole('button', { name: 'Розгорнути бічну панель' })).toBeVisible()
  await expect(sidebar.getByRole('link', { name: 'Жива стрічка', exact: true })).toHaveClass(/active/)
  await page.getByRole('button', { name: 'Розгорнути бічну панель' }).click()
  await expect(page.getByRole('button', { name: 'Згорнути бічну панель' })).toBeVisible()
})

test('approved mobile footer keeps its order, overflow and capability gates accessible', async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-chromium', 'The approved footer is mobile-only.')
  await login(page)

  for (const width of [320, 375, 390, 412]) {
    await page.setViewportSize({ width, height: 820 })
    await page.goto('/feed')
    const footer = page.getByRole('navigation', { name: 'Мобільна навігація' })
    await expect(footer).toBeVisible()
    await expect.poll(() => footer.locator(':scope > a, :scope > button').evaluateAll((elements) =>
      elements.map((element) => element.querySelector('span')?.textContent))).toEqual([
      'Жива стрічка', 'Завдання', 'Чат', 'Диск', 'Ще',
    ])
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
    for (const control of await footer.locator(':scope > a, :scope > button').all()) {
      expect((await control.boundingBox())?.height).toBeGreaterThanOrEqual(44)
    }
  }

  const footer = page.getByRole('navigation', { name: 'Мобільна навігація' })
  await footer.getByRole('link', { name: 'Завдання', exact: true }).click()
  await expect(page).toHaveURL(/\/tasks$/)
  await expect(footer.getByRole('link', { name: 'Завдання', exact: true })).toHaveClass(/active/)

  const more = footer.getByRole('button', { name: 'Ще' })
  await more.click()
  const menu = page.getByRole('menu', { name: 'Ще' })
  await expect(menu).toBeVisible()
  await expect(menu.getByRole('menuitem')).toHaveText(['Календар', 'Співробітники', 'Огляд'])
  await expect(menu.getByRole('menuitem').first()).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(menu.getByRole('menuitem').nth(1)).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(menu).toHaveCount(0)
  await expect(more).toBeFocused()

  await more.click()
  await menu.getByRole('menuitem', { name: 'Огляд', exact: true }).click()
  await expect(page).toHaveURL(/\/overview$/)
  await expect(more).toHaveClass(/active/)

  const adminLogin = await request.post('/api/v1/auth/login', {
    data: { username: 'dmytro', password: 'BertDemoPassphrase2026!' },
  })
  const csrfToken = (await adminLogin.json() as { csrfToken: string }).csrfToken
  const capabilities = await request.get('/api/v1/admin/organization/capabilities')
  const feed = (await capabilities.json() as { items: Array<{ code: string; enabled: boolean; version: number }> }).items
    .find((capability) => capability.code === 'FEED')
  expect(feed).toBeDefined()
  await request.patch('/api/v1/admin/organization/capabilities/FEED', {
    data: { enabled: false, expectedVersion: feed!.version },
    headers: { 'x-csrf-token': csrfToken },
  })

  try {
    await page.context().clearCookies()
    await page.goto('/login')
    await page.getByLabel('Нікнейм').fill('maria')
    await page.getByLabel('Пароль', { exact: true }).fill('BertDemoPassphrase2026!')
    await page.getByRole('button', { name: 'Увійти' }).click()
    await expect(page).toHaveURL(/\/overview$/)
    await expect.poll(() => footer.locator(':scope > a, :scope > button').evaluateAll((elements) =>
      elements.map((element) => element.querySelector('span')?.textContent))).toEqual(['Завдання', 'Чат', 'Диск', 'Ще'])
    await expect(footer.getByRole('link', { name: 'Жива стрічка', exact: true })).toHaveCount(0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  } finally {
    await request.patch('/api/v1/admin/organization/capabilities/FEED', {
      data: { enabled: feed!.enabled, expectedVersion: feed!.version + 1 },
      headers: { 'x-csrf-token': csrfToken },
    })
  }
})

test('unknown route preserves URL and renders branded 404', async ({ page }) => {
  await page.goto('/does-not-exist')
  await expect(page).toHaveURL(/does-not-exist/)
  await expect(page.getByRole('heading', { name: 'Такої сторінки немає' })).toBeVisible()
})

test('legacy company scope is removed while task filters and browser history remain URL-addressable', async ({ page }) => {
  await login(page)
  await page.goto('/overview?company=all')
  await expect(page).not.toHaveURL(/company=/)
  await page.getByRole('button', { name: 'Пошук у BERT CRM' }).click()
  const palette = page.getByRole('dialog', { name: 'Глобальний пошук' })
  await palette.getByRole('textbox').fill('dashboard')
  await palette.getByRole('option', { name: /Підготувати концепцію дизайну dashboard/ }).click()
  await expect(page).toHaveURL(/\/tasks\/tsk_design$/)
  await page.goBack()
  const mobileTaskLink = page.locator('.bottom-nav').getByRole('link', { name: 'Завдання', exact: true })
  const taskLink = (await mobileTaskLink.isVisible()) ? mobileTaskLink : page.locator('.sidebar').getByRole('link', { name: 'Завдання', exact: true })
  await taskLink.click()
  await expect(page).toHaveURL(/\/tasks$/)
  await expect(page.getByRole('heading', { name: 'Завдання', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Пошук і фільтри' }).click()
  const filters = page.locator('.filter-panel')
  await page.getByLabel('Пошук завдань').fill('d')
  await expect(page).toHaveURL(/search=d/)
  await page.getByLabel('Пошук завдань').fill('dashboard')
  await filters.getByLabel('Статус').selectOption('IN_PROGRESS')
  await expect(page).toHaveURL(/search=dashboard/)
  await expect(page).toHaveURL(/status=IN_PROGRESS/)
  await page.getByRole('link', { name: /Підготувати концепцію дизайну dashboard/ }).click()
  await expect(page).toHaveURL(/\/tasks\/tsk_design\?search=dashboard&status=IN_PROGRESS/)
  await page.goBack()
  await expect(page).toHaveURL(/search=dashboard/)
  await expect(page.getByRole('heading', { name: 'Завдання', exact: true })).toBeVisible()
})
