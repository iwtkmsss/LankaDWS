import { afterEach, describe, expect, it } from 'vitest'
import { installLabelClickGuard, shouldBlockLabelActivation } from './labelClickGuard'

function render(html: string) {
  document.body.innerHTML = html
  return (selector: string) => document.querySelector(selector)!
}

describe('label click guard', () => {
  afterEach(() => { document.body.innerHTML = '' })

  it('blocks a caption that wraps a text field', () => {
    const $ = render('<label><span id="caption">Доступність</span><select id="field"><option>Усі</option></select></label>')
    expect(shouldBlockLabelActivation($('#caption'))).toBe(true)
    expect(shouldBlockLabelActivation($('#field'))).toBe(false)
  })

  it('blocks a separate caption linked with for=', () => {
    const $ = render('<label id="caption" for="manager">Керівник</label><div class="search-field"><input id="manager" role="combobox" /></div>')
    expect(shouldBlockLabelActivation($('#caption'))).toBe(true)
  })

  it('keeps the field box, including its icon, clickable', () => {
    const $ = render('<label><span id="caption">Пошук</span><span class="search-field"><svg id="icon"></svg><input id="q" type="search" /></span></label>')
    expect(shouldBlockLabelActivation($('#icon'))).toBe(false)
    expect(shouldBlockLabelActivation($('#q'))).toBe(false)
    expect(shouldBlockLabelActivation($('#caption'))).toBe(true)
  })

  it('keeps native behaviour for checkboxes, radios and file pickers', () => {
    const $ = render(`
      <label><input type="checkbox" /><span id="check">Подія на весь день</span></label>
      <label><input type="radio" name="r" /><span id="radio">Варіант</span></label>
      <label><input type="file" hidden /><span id="file">Додати файл</span></label>`)
    expect(shouldBlockLabelActivation($('#check'))).toBe(false)
    expect(shouldBlockLabelActivation($('#radio'))).toBe(false)
    expect(shouldBlockLabelActivation($('#file'))).toBe(false)
  })

  it('ignores clicks outside labels', () => {
    const $ = render('<div><span id="text">Текст</span></div>')
    expect(shouldBlockLabelActivation($('#text'))).toBe(false)
  })

  it('cancels the caption click so focus stays put', () => {
    const $ = render('<label><span id="caption">Пошук</span><input id="q" /></label>')
    const uninstall = installLabelClickGuard(document)
    const event = new MouseEvent('click', { bubbles: true, cancelable: true })
    $('#caption').dispatchEvent(event)
    uninstall()
    expect(event.defaultPrevented).toBe(true)
    expect(document.activeElement).not.toBe($('#q'))
  })
})
