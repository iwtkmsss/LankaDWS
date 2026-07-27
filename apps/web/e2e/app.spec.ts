import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

async function login(page: Page, username = 'maria') {
  await page.goto('/login')
  await page.getByLabel('Нікнейм').fill(username)
  await page.getByLabel('Пароль', { exact: true }).fill('BertDemoPassphrase2026!')
  await page.getByRole('button', { name: 'Увійти' }).click()
  await expect(page).toHaveURL(/\/overview$/)
  await expect(page.getByRole('heading', { name: 'Жива стрічка', exact: true })).toBeVisible()
}

test('employee feed, canonical navigation and absence wizard are accessible', async ({ page }, testInfo) => {
  await login(page)
  await expect(page.locator('.feed-card').getByText('Марія Іваненко').first()).toBeVisible()
  const eventSource = page.locator('.feed-source-card').filter({ hasText: 'Огляд операцій' })
  await expect(eventSource).toBeVisible()
  await eventSource.getByRole('link', { name: 'Відкрити подію' }).click()
  await expect(page.getByRole('heading', { name: 'Календар', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Огляд операцій' })).toBeVisible()
  await page.goBack()
  await page.getByLabel('Тип події').selectOption('EVENT')
  await expect(page).toHaveURL(/type=EVENT/)
  await expect(page.locator('.feed-source-card').filter({ hasText: 'Огляд операцій' })).toBeVisible()
  await page.getByLabel('Тип події').selectOption('ALL')
  await page.getByRole('button', { name: 'Фільтри', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Додаткові фільтри' })).toBeVisible()
  await expect(page.getByLabel('Кому адресовано').locator('option', { hasText: 'BERT Україна' })).toHaveCount(1)
  await expect(page.getByLabel('Робоча група').locator('option', { hasText: 'Продукт і дизайн' })).toHaveCount(1)
  await expect(page.getByLabel('Робоча група').locator('option', { hasText: 'Люди · приватна група' })).toHaveCount(0)
  await page.getByLabel('Робоча група').selectOption('grp_product_design')
  await expect(page).toHaveURL(/groupId=grp_product_design/)
  await expect(page.locator('.feed-card').filter({ hasText: 'Підготувала компактніший варіант' })).toBeVisible()
  await page.getByLabel('Робоча група').selectOption('')
  await page.getByLabel('Кому адресовано').selectOption('cmp_bert_ua')
  await expect(page).toHaveURL(/audienceId=cmp_bert_ua/)
  await expect(page.locator('.feed-card').filter({ hasText: 'Сьогодні оновили робочий простір' })).toBeVisible()
  await page.getByLabel('Кому адресовано').selectOption('')
  await expect(page.getByLabel('Автор').locator('option', { hasText: 'Андрій Коваль' })).toHaveCount(1)
  await page.getByLabel('Автор').selectOption({ label: 'Андрій Коваль' })
  await expect(page).toHaveURL(/authorId=usr_andrii/)
  await expect(page.locator('.feed-card').filter({ hasText: 'Андрій Коваль' })).toBeVisible()
  const kyivDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Kyiv',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
  await page.getByLabel('Від дати').fill(kyivDate)
  await page.getByLabel('До дати').fill(kyivDate)
  await expect(page).toHaveURL(new RegExp(`dateFrom=${kyivDate}.*dateTo=${kyivDate}`))
  await page.screenshot({
    path: `artifacts/screenshots/${testInfo.project.name}-feed-filters.png`,
    fullPage: true,
  })
  await page.getByLabel('Мене згадали').check()
  await expect(page).toHaveURL(/mentioned=true/)
  await page.getByLabel('Мене згадали').uncheck()
  await page.getByLabel('Лише обране').check()
  await expect(page).toHaveURL(/favorite=true/)
  await page.getByLabel('Лише обране').uncheck()
  await page.getByRole('button', { name: 'Очистити додаткові' }).click()
  await expect(page).not.toHaveURL(/authorId|groupId|audienceId|dateFrom|dateTo|mentioned|favorite|important/)
  await page.getByLabel('Важливі публікації').check()
  await expect(page).toHaveURL(/important=true/)
  await expect(page.locator('.feed-acknowledgement').first()).toBeVisible()
  await page.getByLabel('Важливі публікації').uncheck()
  await expect(page).not.toHaveURL(/authorId|groupId|audienceId|dateFrom|dateTo|mentioned|favorite|important/)
  await page.getByRole('button', { name: 'Закрити додаткові фільтри' }).click()
  const overviewA11y = await new AxeBuilder({ page }).analyze()
  expect(overviewA11y.violations).toEqual([])
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))
  await page.screenshot({ path: `artifacts/screenshots/${testInfo.project.name}-feed.png`, fullPage: true })
  await page.goto('/requests/new?type=absence')
  await expect(page.getByRole('heading', { name: 'Коли вас не буде?' })).toBeVisible()
  await page.getByLabel('Перший день').fill('2027-03-15')
  await page.getByLabel('Останній день').fill('2027-03-19')
  await page.getByRole('button', { name: /Далі/ }).click()
  await expect(page.getByRole('heading', { name: 'Хто підстрахує?' })).toBeVisible()
})

test('manager receives an approval queue and admin content does not flash for employee', async ({ page }) => {
  await login(page, 'andrii')
  await page.goto('/overview?company=cmp_bert_service')
  await expect(page.getByRole('heading', { name: 'Огляд', exact: true })).toBeVisible()
  await expect(page).not.toHaveURL(/company=/)
  await expect(page.getByText('Потребують рішення')).toBeVisible()
  await page.goto('/admin/roles')
  await expect(page.getByRole('heading', { name: 'У вас немає доступу' })).toBeVisible()
  await expect(page.getByText('Ролі та права')).toHaveCount(0)
})

test('chat search, exact read state, replies, mute and direct creation stay compact', async ({ page }, testInfo) => {
  const isMobile = testInfo.project.name === 'mobile-chromium'
  const teammateName = isMobile ? 'Дмитро Савчук' : 'Олена Бондар'
  const teammateSearch = isMobile ? 'Дмитро' : 'Олена'
  await login(page, isMobile ? 'andrii' : 'maria')
  await page.goto('/messages?company=cmp_bert_ua')
  await expect(page.getByRole('heading', { name: 'Чат', exact: true })).toBeVisible()
  await page.getByPlaceholder('Діалог або повідомлення').fill('dashboard')
  await expect(page).toHaveURL(/q=dashboard/)
  await page.getByRole('link', { name: /Дизайн dashboard/ }).click()
  const currentChat = page.getByLabel('Поточний діалог')
  await expect(currentChat.getByRole('heading', { name: 'Дизайн dashboard', exact: true })).toBeVisible()
  await expect(currentChat.locator('#message-msg_design')).toHaveText(
    'Перевірмо фокус-блок і mobile-поведінку перед публікацією.',
  )

  await currentChat.getByRole('button', { name: 'Учасники діалогу' }).click()
  const participantsDrawer = page.getByRole('dialog', { name: 'Учасники діалогу' })
  await expect(participantsDrawer.getByText('Марія Іваненко')).toBeVisible()
  await expect(participantsDrawer.getByText('Андрій Коваль')).toBeVisible()
  if (!isMobile) {
    await participantsDrawer.getByPlaceholder('Ім’я або нікнейм').fill('Олена')
    await participantsDrawer.getByRole('button', { name: /Олена Бондар/ }).click()
    await expect(participantsDrawer.getByText('Олена Бондар')).toBeVisible()
  }
  await page.screenshot({
    path: `artifacts/screenshots/${testInfo.project.name}-chat-participants.png`,
    fullPage: true,
  })
  await participantsDrawer.getByRole('button', { name: 'Закрити' }).click()

  await currentChat.getByRole('button', { name: 'Відповісти' }).click()
  const replyText = `Погоджено у чаті · ${testInfo.project.name} · ${Date.now()}`
  const attachmentName = `chat-${testInfo.project.name}.txt`
  await currentChat.locator('input[type="file"]').setInputFiles({
    name: attachmentName,
    mimeType: 'text/plain',
    buffer: Buffer.from('Контекст для робочого діалогу'),
  })
  await expect(currentChat.getByText(attachmentName)).toBeVisible()
  await currentChat.getByPlaceholder('Написати відповідь').fill(replyText)
  await currentChat.getByRole('button', { name: 'Надіслати повідомлення' }).click()
  await expect(currentChat.locator('.chat-stream p', { hasText: replyText })).toHaveText(replyText)
  const replyCard = currentChat.locator('.chat-stream article').filter({ hasText: replyText })
  await expect(replyCard.getByText(attachmentName)).toBeVisible()
  await replyCard.getByLabel('Дії з повідомленням').click()
  await replyCard.getByRole('button', { name: 'Редагувати' }).click()
  const editedReplyText = `${replyText} · уточнено`
  await replyCard.getByLabel('Змінити повідомлення').fill(editedReplyText)
  await replyCard.getByRole('button', { name: 'Зберегти' }).click()
  await expect(replyCard.locator('p')).toHaveText(editedReplyText)
  await expect(replyCard.getByText(/ред\./)).toBeVisible()
  await replyCard.getByLabel('Дії з повідомленням').click()
  await replyCard.getByRole('button', {
    name: isMobile ? 'Додати в календар' : 'Створити завдання',
  }).click()
  const conversionDrawer = page.getByRole('dialog', {
    name: isMobile ? 'Додати в календар' : 'Створити завдання',
  })
  await expect(conversionDrawer.getByLabel('Назва')).toHaveValue(editedReplyText)
  await conversionDrawer.getByRole('button', {
    name: isMobile ? 'Додати подію' : 'Створити завдання',
  }).click()
  await expect(page.getByRole('dialog', {
    name: isMobile ? 'Подію додано' : 'Завдання створено',
  })).toBeVisible()
  await page.getByRole('button', { name: 'Повернутися до діалогу' }).click()
  const enableNotifications = currentChat.getByRole('button', { name: 'Увімкнути сповіщення' })
  if (await enableNotifications.isVisible()) {
    await enableNotifications.click()
    await expect(currentChat.getByRole('button', { name: 'Вимкнути сповіщення' })).toBeVisible()
  }
  await currentChat.getByRole('button', { name: 'Вимкнути сповіщення' }).click()
  await expect(currentChat.getByRole('button', { name: 'Увімкнути сповіщення' })).toBeVisible()
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  await page.screenshot({
    path: `artifacts/screenshots/${testInfo.project.name}-chat-thread.png`,
    fullPage: true,
  })
  const replyMessageElementId = await replyCard.locator('p').getAttribute('id')
  expect(replyMessageElementId).toBeTruthy()
  await replyCard.getByLabel('Дії з повідомленням').click()
  await replyCard.getByRole('button', { name: 'Видалити' }).click()
  await replyCard.getByRole('button', { name: 'Видалити', exact: true }).click()
  await expect(currentChat.locator(`[id="${replyMessageElementId!}"]`)).toHaveText('Повідомлення видалено')
  await expect(currentChat.getByText(attachmentName)).toHaveCount(0)

  if (isMobile) {
    await currentChat.getByRole('link', { name: 'Назад до списку діалогів' }).click()
    await expect(page.getByLabel('Діалоги')).toBeVisible()
  }
  await page.getByRole('button', { name: 'Новий діалог' }).click()
  const drawer = page.getByRole('dialog', { name: 'Новий діалог' })
  await expect(drawer).toBeVisible()
  await drawer.getByPlaceholder('Ім’я або нікнейм').fill(teammateSearch)
  await drawer.getByRole('button', { name: new RegExp(teammateName) }).click()
  await drawer.getByRole('button', { name: 'Створити діалог' }).click()
  await expect(page.getByRole('heading', { name: teammateName, exact: true })).toBeVisible()
  await expect(page).toHaveURL(/\/messages\/thr_/)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
})

test('feed publishing, acknowledgement and comments remain explicit', async ({ page }, testInfo) => {
  await login(page, testInfo.project.name === 'mobile-chromium' ? 'olena' : 'maria')
  const postText = `Перевірка зручності стрічки · ${testInfo.project.name}`
  await page.getByLabel('Текст публікації').fill(postText)
  await page.getByLabel('Додати файл').setInputFiles({
    name: `feed-${testInfo.project.name}.txt`,
    mimeType: 'text/plain',
    buffer: Buffer.from('Вкладення стрічки'),
  })
  await expect(page.getByText(`feed-${testInfo.project.name}.txt`)).toBeVisible()
  await page.getByRole('button', { name: 'Опублікувати', exact: true }).click()
  await expect(page.getByText('Публікацію додано до стрічки.')).toBeVisible()
  const card = page.locator('.feed-card').filter({ hasText: postText })
  await expect(card).toBeVisible()
  await card.getByRole('button', { name: 'Стежу', exact: true }).click()
  await card.getByRole('menuitemradio', { name: 'Без сповіщень' }).click()
  await expect(card.getByRole('button', { name: 'Стежити', exact: true })).toBeVisible()
  await card.getByRole('button', { name: 'Стежити', exact: true }).click()
  await card.getByRole('menuitemradio', { name: 'Лише згадки' }).click()
  await expect(card.getByRole('button', { name: 'Лише згадки', exact: true })).toBeVisible()
  await page.getByRole('tab', { name: 'Стежу', exact: true }).click()
  await expect(page).toHaveURL(/filter=FOLLOWING/)
  await expect(card).toBeVisible()
  await page.getByRole('tab', { name: 'Усі', exact: true }).click()
  await card.getByRole('button', { name: 'Додати в обране' }).click()
  await expect(card.getByRole('button', { name: 'Прибрати з обраного' })).toBeVisible()
  await page.goto('/overview?favorite=true')
  const favoriteCard = page.locator('.feed-card').filter({ hasText: postText })
  await expect(favoriteCard).toBeVisible()
  await favoriteCard.getByRole('button', { name: 'Прибрати з обраного' }).click()
  await expect(favoriteCard).not.toBeVisible()
  await page.goto('/overview')
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
  await page.goto('/tasks/new?company=cmp_bert_ua')
  await page.getByLabel('Назва', { exact: true }).fill(parentTitle)
  await page.getByLabel('Виконавець').selectOption(assigneeId)
  await page.getByLabel('Опис').fill('Один зрозумілий результат із окремою відповідальною підзадачею.')
  await page.getByRole('button', { name: 'Створити', exact: true }).click()
  await expect(page.getByRole('heading', { name: parentTitle })).toBeVisible()

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

  const materials = page.locator('.task-materials')
  await materials.getByText('Матеріали', { exact: true }).click()
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
  await page.goto('/tasks/new?company=cmp_bert_ua')
  await page.getByLabel('Назва', { exact: true }).fill(title)
  await page.getByLabel('Виконавець').selectOption('usr_andrii')
  await page.getByRole('button', { name: 'Створити', exact: true }).click()
  await expect(page.getByRole('heading', { name: title })).toBeVisible()
  await page.getByRole('button', { name: 'Керувати' }).click()
  const participantSection = page.locator('.task-participants')
  const participantId = testInfo.project.name === 'mobile-chromium' ? 'usr_dmytro' : 'usr_marko'
  const participantName = testInfo.project.name === 'mobile-chromium' ? 'Дмитро Савчук' : 'Марко Литвин'
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

test('standalone file sharing is explicit, scanner-aware and revocable', async ({ page }, testInfo) => {
  await login(page, 'dmytro')
  const fileName = `standalone-${testInfo.project.name}.txt`
  await page.getByLabel('Поширити файл').setInputFiles({
    name: fileName,
    mimeType: 'text/plain',
    buffer: Buffer.from('Окремо поширений файл у стрічці'),
  })
  await expect(page.getByText('Файл поширено. Завантаження відкриється після безпечної перевірки.')).toBeVisible()
  const card = page.locator('.feed-source-card').filter({ hasText: fileName })
  await expect(card).toBeVisible()
  await expect(card.getByText('Перевіряється', { exact: true })).toBeVisible()
  await page.getByLabel('Тип події').selectOption('FILE')
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
