import AxeBuilder from '@axe-core/playwright'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test, type Page } from '@playwright/test'

const screenshotDir = resolve(process.cwd(), '../../output/playwright/messages')
mkdirSync(screenshotDir, { recursive: true })

async function login(page: Page, username = 'maria') {
  await page.goto('/login')
  await page.getByLabel('Нікнейм').fill(username)
  await page.getByLabel('Пароль', { exact: true }).fill('LankaDWSDemoPassphrase2026!')
  await page.getByRole('button', { name: 'Увійти' }).click()
  await expect(page).toHaveURL(/\/feed$/)
}

async function screenshot(page: Page, project: string, state: string) {
  await page.screenshot({
    path: resolve(screenshotDir, `${project}-${state}.png`),
    fullPage: true,
  })
}

async function configureViewport(page: Page, project: string) {
  await page.setViewportSize(
    project === 'mobile-chromium'
      ? { width: 390, height: 844 }
      : { width: 1440, height: 900 },
  )
}

test('messages workspace covers user-only search, direct history and real chat actions', async ({ page }, testInfo) => {
  await configureViewport(page, testInfo.project.name)
  await login(page)
  await page.goto('/messages')

  await expect(page.getByRole('heading', { name: 'Повідомлення', exact: true })).toHaveCount(0)
  await expect(page.locator('.topbar').getByRole('button', { name: 'Новий чат' })).toBeVisible()
  await expect(page.getByRole('combobox', { name: 'Пошук користувачів' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Створити', exact: true })).toHaveCount(0)
  await expect(page.getByRole('tab', { name: /Усі/ })).toBeVisible()
  await expect(page.getByRole('tab', { name: /Непрочитані/ })).toBeVisible()
  await expect(page.getByRole('tab', { name: /Згадки/ })).toHaveCount(0)
  await screenshot(page, testInfo.project.name, 'empty')

  const search = page.getByRole('combobox', { name: 'Пошук користувачів' })
  await search.fill('о')
  await expect(page.getByRole('option', { name: /Олена Бондар/ })).toBeVisible()
  await expect(page.locator('.messages-thread-list')).toHaveCount(0)
  await screenshot(page, testInfo.project.name, 'user-search')

  await page.getByRole('option', { name: /Олена Бондар/ }).click()
  await expect(page).toHaveURL(/\/messages(?:\/thr_|\?to=usr_olena)/)
  const conversation = page.getByRole('region', { name: /Діалог: Олена Бондар/ })
  await expect(conversation).toBeVisible()
  await expect(conversation.getByRole('button', { name: /дзвін/i })).toHaveCount(0)
  await expect(conversation.getByRole('button', { name: /відео/i })).toHaveCount(0)

  const composer = conversation.getByRole('textbox', { name: 'Повідомлення' })
  const body = `Перевірка нового діалогу · ${testInfo.project.name} · ${Date.now()}`
  await composer.fill(body)
  await expect(page).toHaveURL(/\/messages\/thr_/)
  await composer.press('Enter')
  const sent = conversation.locator('.message-row').filter({ hasText: body })
  await expect(sent).toBeVisible()

  await sent.getByRole('button', { name: 'Відповісти' }).click()
  const reply = `${body} · відповідь`
  await composer.fill(reply)
  await conversation.getByRole('button', { name: 'Надіслати' }).click()
  const replyBubble = conversation.locator('.message-row').filter({ hasText: reply })
  await expect(replyBubble).toBeVisible()

  const attachmentName = `messages-${testInfo.project.name}.txt`
  await conversation.locator('input[type="file"]').setInputFiles({
    name: attachmentName,
    mimeType: 'text/plain',
    buffer: Buffer.from('LankaDWS messages visual QA'),
  })
  await expect(conversation.getByText(attachmentName)).toBeVisible()
  const attachmentBody = `${body} · вкладення`
  await composer.fill(attachmentBody)
  await conversation.getByRole('button', { name: 'Надіслати' }).click()
  const attachmentBubble = conversation.locator('.message-row').filter({ hasText: attachmentBody })
  await expect(attachmentBubble.getByText(attachmentName)).toBeVisible()

  await attachmentBubble.getByRole('button', { name: 'Дії з повідомленням' }).click()
  await attachmentBubble.getByRole('button', { name: 'Редагувати' }).click()
  const editedBody = `${attachmentBody} · змінено`
  await attachmentBubble.locator('textarea').fill(editedBody)
  await attachmentBubble.getByRole('button', { name: 'Зберегти' }).click()
  await expect(attachmentBubble).toContainText(editedBody)
  await expect(attachmentBubble).toContainText('змінено')

  await attachmentBubble.getByRole('button', { name: 'Дії з повідомленням' }).click()
  await attachmentBubble.getByRole('button', { name: 'Створити завдання' }).click()
  const conversion = page.getByRole('dialog', { name: 'Створити завдання' })
  await expect(conversion.getByLabel('Назва')).toHaveValue(editedBody)
  await conversion.getByRole('button', { name: 'Створити', exact: true }).click()
  await expect(conversion).toHaveCount(0)

  await conversation.getByRole('button', { name: 'Пошук у діалозі' }).click()
  const conversationSearch = conversation.getByRole('searchbox', { name: 'Пошук у діалозі' })
    .or(conversation.getByRole('textbox', { name: 'Пошук у діалозі' }))
  await conversationSearch.fill('вкладення')
  await expect(conversation.locator('.conversation-search__results')).toContainText(editedBody)
  await conversation.locator('.conversation-search__results button').first().click()
  await expect(conversation.getByRole('button', { name: /Повернутися до нових/ })).toBeVisible()
  await conversation.getByRole('button', { name: /Повернутися до нових/ }).click()

  await conversation.getByRole('button', { name: 'Інші дії' }).click()
  const mute = conversation.getByRole('button', { name: 'Вимкнути сповіщення' })
  const unmute = conversation.getByRole('button', { name: 'Увімкнути сповіщення' })
  if (await mute.isVisible()) {
    await mute.click()
    await conversation.getByRole('button', { name: 'Інші дії' }).click()
  }
  await expect(unmute).toBeVisible()
  await conversation.getByRole('button', { name: 'Інші дії' }).click()

  await conversation.getByRole('button', { name: 'Інформація про діалог' }).click()
  const profilePanel = page.getByRole('complementary', { name: 'Чат і сповіщення' })
  await expect(profilePanel.getByText('@olena')).toBeVisible()
  await expect(profilePanel.getByRole('region', { name: 'Коротка інформація про користувача' })).toBeVisible()
  await profilePanel.getByRole('button', { name: 'Закрити праву панель' }).click()

  await screenshot(page, testInfo.project.name, 'active-conversation')
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)

  const attachmentMessageId = await attachmentBubble.getAttribute('id')
  expect(attachmentMessageId).toBeTruthy()
  await attachmentBubble.getByRole('button', { name: 'Дії з повідомленням' }).click()
  await attachmentBubble.getByRole('button', { name: 'Видалити' }).click()
  await expect(conversation.locator(`#${attachmentMessageId!}`)).toContainText('Повідомлення видалено')

  if (testInfo.project.name === 'mobile-chromium') {
    await expect(page.locator('.bottom-nav')).toBeHidden()
    await conversation.getByRole('button', { name: 'До списку діалогів' }).click()
    await expect(page).toHaveURL(/\/messages(?:\?|$)/)
    await expect(page.getByRole('heading', { name: 'Повідомлення' })).toHaveCount(0)
    await expect(page.getByRole('combobox', { name: 'Пошук користувачів' })).toBeVisible()
  }
})

test('new chat compose reuses canonical direct threads from a one-symbol keyboard search', async ({ page }, testInfo) => {
  await configureViewport(page, testInfo.project.name)
  await login(page)
  await page.goto('/messages?new=1')

  const compose = page.getByRole('dialog', { name: 'Новий чат' })
  const search = compose.getByRole('combobox', { name: 'Пошук користувачів для нового чату' })
  await expect(search).toBeFocused()
  await search.fill('о')
  await expect(compose.getByRole('option', { name: /Олена Бондар/ })).toBeVisible()
  await search.fill('Олена')
  await expect(compose.getByRole('option', { name: /Олена Бондар/ })).toBeVisible()
  await search.press('ArrowDown')
  await search.press('Enter')
  await expect(page).toHaveURL(/\/messages(?:\/thr_|\?to=usr_olena)/)
  await page.getByRole('textbox', { name: 'Повідомлення', exact: true }).fill('Початок нового діалогу')
  await expect(page).toHaveURL(/\/messages\/thr_/)
  const directUrl = page.url()

  await page.goto('/messages?new=1&to=usr_olena')
  await expect(page).toHaveURL(directUrl)
  await expect(page.getByRole('region', { name: /Діалог: Олена Бондар/ })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
})

test('a searched contact stays transient until the first message is sent', async ({ page }, testInfo) => {
  await configureViewport(page, testInfo.project.name)
  await login(page)
  await page.goto('/messages?new=1')

  const compose = page.getByRole('dialog', { name: 'Новий чат' })
  const search = compose.getByRole('combobox', { name: 'Пошук користувачів для нового чату' })
  const target = testInfo.project.name === 'mobile-chromium'
    ? { id: 'usr_dmytro', query: 'Дмитро', name: 'Дмитро Савчук' }
    : { id: 'usr_marko', query: 'Марко', name: 'Марко Литвин' }
  await search.fill(target.query)
  await compose.getByRole('option', { name: new RegExp(target.name) }).click()
  await expect(page).toHaveURL(new RegExp(`/messages\\?to=${target.id}`))
  await expect(page.getByRole('region', { name: new RegExp(`Діалог: ${target.name}`) })).toBeVisible()

  await page.goto('/messages')
  await expect(page.locator('.messages-thread-list button').filter({ hasText: target.name })).toHaveCount(0)

  await page.goto(`/messages?to=${target.id}`)
  const draft = 'Чернетка, яка зберігає початок чату'
  await page.getByRole('textbox', { name: 'Повідомлення', exact: true }).fill(draft)
  await expect(page).toHaveURL(/\/messages\/thr_/)
  await expect(page.getByRole('textbox', { name: 'Повідомлення', exact: true })).toHaveValue(draft)
  await page.getByRole('textbox', { name: 'Повідомлення', exact: true }).press('Enter')
  await expect(page.locator('.message-row').filter({ hasText: draft })).toBeVisible()
  await page.goto('/messages')
  await expect(page.locator('.messages-thread-list button').filter({ hasText: target.name })).toBeVisible()
})

test('new group remains a local messages-only action', async ({ page }, testInfo) => {
  await configureViewport(page, testInfo.project.name)
  await login(page)
  await page.goto('/messages')
  await page.getByRole('button', { name: 'Новий чат' }).click()
  await page.getByRole('dialog', { name: 'Новий чат' }).getByRole('button', { name: 'Створити групу' }).click()
  const drawer = page.getByRole('dialog', { name: 'Нова група' })
  await expect(drawer).toBeVisible()
  await screenshot(page, testInfo.project.name, 'group-drawer')

  const title = `QA група ${testInfo.project.name} ${Date.now()}`
  await drawer.getByLabel('Назва групи').fill(title)
  const search = drawer.getByPlaceholder('Ім’я або нікнейм')
  await search.fill('Олена')
  await drawer.getByRole('button', { name: /Олена Бондар/ }).click()
  await search.fill('Дмитро')
  await drawer.getByRole('button', { name: /Дмитро Савчук/ }).click()
  await drawer.getByRole('button', { name: 'Створити групу' }).click()

  await expect(page).toHaveURL(/\/messages\/thr_/)
  const conversation = page.getByRole('region', { name: `Діалог: ${title}` })
  await expect(conversation).toBeVisible()
  await expect(conversation.getByText('3 учасників')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
})
