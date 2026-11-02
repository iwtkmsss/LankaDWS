import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, Check, Copy, FlaskConical, LayoutGrid, MapPin, Monitor, Moon, Play, RotateCcw, Search, Smartphone, Sun, Tablet, X } from 'lucide-react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { Button, IconButton } from '../../shared/ui'
import { applyTheme, getStoredTheme } from '../../shared/theme'
import { FeedStoryExample } from './FeedStoryExample'
import { feedStories, type FeedStory, type ShowcaseSection } from './feedShowcaseData'
import { supportingStories, type SupportingStory } from './FeedSupportingExamples'
import { showcaseBlockType, showcaseBlockTypes, showcasePlacement, type ShowcaseBlockType } from './feedShowcaseNavigation'
import './feed-showcase.css'

const sections: Array<{ id: ShowcaseSection; label: string; detail: string }> = [
  { id: 'overview', label: 'Перший погляд', detail: 'П’ять основних прикладів' },
  { id: 'posts', label: 'Публікації', detail: 'Текст, ознайомлення, коментарі' },
  { id: 'events', label: 'Події календаря', detail: 'Час, учасники, підтвердження' },
  { id: 'tasks', label: 'Завдання', detail: 'Усі комбінації змін' },
  { id: 'files', label: 'Перегляд вкладень', detail: 'Зображення, документи й текст' },
  { id: 'page', label: 'Сторінка й віджети', detail: 'Завантаження, огляд, увага' },
  { id: 'composer', label: 'Створення публікації', detail: 'Поля, вкладення, помилки' },
  { id: 'all', label: 'Усі стани', detail: 'Повна галерея' },
]
const total = feedStories.length + supportingStories.length
const allExamples = [...feedStories, ...supportingStories]
const blockCounts = new Map(showcaseBlockTypes.map((type) => [type.id, allExamples.filter((story) => showcaseBlockType(story) === type.id).length]))
type ShowcaseExample = { kind: 'card'; story: FeedStory } | { kind: 'support'; story: SupportingStory }
function count(section: ShowcaseSection) { return section === 'all' ? total : section === 'overview' ? feedStories.filter((story) => story.featured).length : feedStories.filter((story) => story.group === section).length + supportingStories.filter((story) => story.group === section).length }

export default function FeedShowcasePage() {
  const [params, setParams] = useSearchParams()
  const location = useLocation()
  const navigate = useNavigate()
  const selected = sections.some((section) => section.id === params.get('section')) ? params.get('section') as ShowcaseSection : 'overview'
  const width = ['tablet', 'mobile'].includes(params.get('width') ?? '') ? params.get('width')! : 'desktop'
  const [search, setSearch] = useState('')
  const [version, setVersion] = useState(0)
  const [theme, setTheme] = useState(getStoredTheme)
  const [presenting, setPresenting] = useState(false)
  const [copied, setCopied] = useState('')
  const [fallbackLink, setFallbackLink] = useState('')
  const [activeBlock, setActiveBlock] = useState<ShowcaseBlockType>('posts')
  const jumpbarRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  useEffect(() => { applyTheme(theme); return () => applyTheme(getStoredTheme()) }, [theme])
  useEffect(() => {
    if (!location.hash) return
    const frame = requestAnimationFrame(() => document.getElementById(location.hash.slice(1))?.scrollIntoView({ block: 'start', behavior: 'instant' }))
    return () => cancelAnimationFrame(frame)
  }, [location.hash, selected])
  const normalized = search.trim().toLocaleLowerCase('uk-UA')
  const matches = (story: { title: string; description: string; id: string }) => `${story.title} ${story.description} ${story.id}`.toLocaleLowerCase('uk-UA').includes(normalized)
  const cards = feedStories.filter((story) => normalized ? matches(story) : selected === 'all' || selected === story.group || (selected === 'overview' && story.featured))
  const support = supportingStories.filter((story) => normalized ? matches(story) : selected === 'all' || selected === story.group)
  const current = sections.find((section) => section.id === selected)!
  const examples: ShowcaseExample[] = [
    ...cards.map((story) => ({ kind: 'card' as const, story })),
    ...support.map((story) => ({ kind: 'support' as const, story })),
  ]
  const groups = showcaseBlockTypes.map((type) => ({
    ...type,
    examples: examples.filter(({ story }) => showcaseBlockType(story) === type.id),
  })).filter((group) => group.examples.length > 0)
  const exampleNumbers = new Map(groups.flatMap((group) => group.examples).map(({ story }, index) => [story.id, index + 1]))
  const visibleActiveBlock = groups.some((group) => group.id === activeBlock) ? activeBlock : groups[0]?.id
  const jumpOptions = selected === 'all' || normalized ? groups : showcaseBlockTypes
  const activeIndex = jumpOptions.findIndex((type) => type.id === visibleActiveBlock)

  useEffect(() => {
    let frame = 0
    function updateActiveBlock() {
      frame = 0
      const blocks = stageRef.current?.querySelectorAll<HTMLElement>('[data-showcase-block]')
      if (!blocks?.length) return
      const offset = (jumpbarRef.current?.getBoundingClientRect().bottom ?? 0) + 48
      let active = blocks[0].dataset.showcaseBlock as ShowcaseBlockType
      for (const block of blocks) {
        if (block.getBoundingClientRect().top <= offset) active = block.dataset.showcaseBlock as ShowcaseBlockType
      }
      setActiveBlock(active)
    }
    function scheduleUpdate() {
      if (!frame) frame = requestAnimationFrame(updateActiveBlock)
    }
    scheduleUpdate()
    window.addEventListener('scroll', scheduleUpdate, { passive: true })
    window.addEventListener('resize', scheduleUpdate)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('scroll', scheduleUpdate)
      window.removeEventListener('resize', scheduleUpdate)
    }
  }, [selected, normalized, version, width, presenting])

  function jumpToBlock(id: ShowcaseBlockType) {
    const target = showcaseBlockTypes.find((type) => type.id === id)!
    const next = new URLSearchParams(params)
    if ((!normalized && selected === 'overview') || !groups.some((group) => group.id === id)) {
      next.set('section', target.section)
      setSearch('')
    }
    setActiveBlock(id)
    document.getElementById(`showcase-group-${id}`)?.scrollIntoView({ block: 'start', behavior: 'instant' })
    navigate({ search: `?${next}`, hash: `showcase-group-${id}` })
  }

  function showAllBlocks() {
    const next = new URLSearchParams(params)
    next.set('section', 'all')
    setSearch('')
    navigate({ search: `?${next}`, hash: `showcase-group-${visibleActiveBlock ?? 'posts'}` })
  }

  function updateParam(name: string, value: string) {
    const next = new URLSearchParams(params)
    next.set(name, value)
    setParams(next)
    if (name === 'section') { setSearch(''); setCopied(''); setFallbackLink('') }
  }
  async function copyLink(id: string, section: string) {
    const url = new URL(window.location.href)
    url.searchParams.set('section', section)
    url.hash = id
    try { await navigator.clipboard.writeText(url.toString()); setCopied(id); setFallbackLink('') }
    catch { setCopied('failed'); setFallbackLink(url.toString()) }
  }
  return <div className={`feed-showcase${presenting ? ' is-presenting' : ''}`}>
    <header className="showcase-heading"><div><Link to="/feed" className="showcase-back"><ArrowLeft size={14} />До живої стрічки</Link><div className="showcase-title"><span><FlaskConical size={22} /></span><h1>Галерея живої стрічки</h1><span className="showcase-version">Дизайн · 01</span></div><p>Єдина мова карток. Усі стани, чітка структура й продумані взаємодії.</p></div><Button type="button" variant="secondary" onClick={() => setPresenting(!presenting)}>{presenting ? <X size={16} /> : <Play size={16} />}{presenting ? 'Завершити показ' : 'Режим показу'}</Button></header>
    <div className="showcase-info"><span><span className="showcase-live-dot" />Демонстраційна сторінка</span><p>Прикладів: {total} · дії працюють локально · робочі записи не змінюються</p></div>
    <div className="showcase-layout"><nav className="showcase-nav" aria-label="Розділи галереї"><span className="showcase-nav__label">КАТАЛОГ СТАНІВ</span>{sections.map((section) => <button type="button" key={section.id} aria-current={selected === section.id && !normalized ? 'page' : undefined} onClick={() => updateParam('section', section.id)}><span><strong>{section.label}</strong><small>{section.detail}</small></span><b>{count(section.id)}</b></button>)}<div className="showcase-nav__legend"><strong>Логіка кольорів</strong><span><i className="is-accent" />Очікує вашої дії</span><span><i className="is-success" />Підтверджено</span><span><i className="is-warning" />Перевіряється</span><span><i className="is-danger" />Помилка або блокування</span></div></nav>
      <div className="showcase-main"><div className="showcase-toolbar"><label className="showcase-search"><Search size={16} /><input type="search" aria-label="Знайти стан у галереї" placeholder="Знайти стан у галереї…" value={search} onChange={(event) => setSearch(event.target.value)} /></label><div className="showcase-widths" role="group" aria-label="Ширина прикладів">{[{ value: 'desktop', Icon: Monitor, label: 'Повна ширина' }, { value: 'tablet', Icon: Tablet, label: 'Планшет · 768 px' }, { value: 'mobile', Icon: Smartphone, label: 'Телефон · 390 px' }].map(({ value, Icon, label }) => <IconButton key={value} label={label} className={width === value ? 'is-active' : ''} aria-pressed={width === value} onClick={() => updateParam('width', value)}><Icon size={17} /></IconButton>)}</div><IconButton label={theme === 'dark' ? 'Світла тема прикладів' : 'Темна тема прикладів'} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}</IconButton><IconButton label="Скинути зміни прикладів" onClick={() => setVersion((currentVersion) => currentVersion + 1)}><RotateCcw size={17} /></IconButton></div>
        {fallbackLink && <div className="showcase-link-fallback"><label>Скопіюйте посилання на приклад<input autoFocus readOnly value={fallbackLink} onFocus={(event) => event.currentTarget.select()} /></label><IconButton label="Закрити посилання" onClick={() => setFallbackLink('')}><X size={15} /></IconButton></div>}
        <div className="showcase-section-heading"><div><span className="showcase-nav__label">{normalized ? 'ПОШУК У ВСІЙ ГАЛЕРЕЇ' : 'ГАЛЕРЕЯ КОМПОНЕНТІВ'}</span><h2>{normalized ? 'Результати пошуку' : current.label}<span>{cards.length + support.length}</span></h2></div><span className="showcase-width-label"><LayoutGrid size={14} />{width === 'mobile' ? '390 px' : width === 'tablet' ? '768 px' : 'На всю ширину'}</span></div>
        {selected === 'overview' && !normalized && <div className="showcase-anatomy"><span>Будова картки</span><ol>{['Шапка', 'Зміст', 'Вкладення / зміни', 'Ознайомлення', 'Дії', 'Обговорення'].map((part, index) => <li key={part}><b>{index + 1}</b>{part}</li>)}</ol></div>}
        {groups.length > 0 && <div className="showcase-jumpbar" ref={jumpbarRef}>
          <div className="showcase-jumpbar__controls">
            <label htmlFor="showcase-block-picker">Тип блоку
              <select id="showcase-block-picker" value={visibleActiveBlock} onChange={(event) => jumpToBlock(event.target.value as ShowcaseBlockType)}>
                {jumpOptions.map((type) => <option key={type.id} value={type.id}>{type.label} · {normalized ? groups.find((group) => group.id === type.id)!.examples.length : blockCounts.get(type.id)}</option>)}
              </select>
            </label>
            <div className="showcase-jumpbar__steps">
              <IconButton label="Попередній тип блоку" disabled={activeIndex <= 0} onClick={() => jumpToBlock(jumpOptions[activeIndex - 1].id)}><ArrowLeft size={17} /></IconButton>
              <IconButton label="Наступний тип блоку" disabled={activeIndex < 0 || activeIndex === jumpOptions.length - 1} onClick={() => jumpToBlock(jumpOptions[activeIndex + 1].id)}><ArrowRight size={17} /></IconButton>
            </div>
            <Button type="button" variant="secondary" className="showcase-jumpbar__all" disabled={selected === 'all' && !normalized} onClick={showAllBlocks}>Усі стани · {total}</Button>
            {presenting && <IconButton label="Завершити показ" onClick={() => setPresenting(false)}><X size={17} /></IconButton>}
          </div>
          <nav className="showcase-jumpbar__types" aria-label="Швидкий перехід між типами блоків">
            {jumpOptions.map((type) => <button key={type.id} type="button" aria-current={visibleActiveBlock === type.id ? 'location' : undefined} onClick={() => jumpToBlock(type.id)}>{type.label}<span>{normalized ? groups.find((group) => group.id === type.id)!.examples.length : blockCounts.get(type.id)}</span></button>)}
          </nav>
        </div>}
        <div className={`showcase-stage is-${width}`} key={version} ref={stageRef}>
          {groups.map((group) => <section className="showcase-block-group" data-showcase-block={group.id} id={`showcase-group-${group.id}`} key={group.id} aria-labelledby={`showcase-group-title-${group.id}`}>
            <header className={`showcase-block-group__heading${groups.length === 1 ? ' sr-only' : ''}`}><h2 id={`showcase-group-title-${group.id}`}>{group.label}<span>{group.examples.length}</span></h2></header>
            {group.examples.map((example) => {
              const { story } = example
              return <section className="showcase-example" key={story.id} id={story.id} aria-labelledby={`${story.id}-title`}>
                <header className="showcase-example__label">
                  <span className="showcase-example__number">{String(exampleNumbers.get(story.id)).padStart(2, '0')}</span>
                  <div>
                    <h3 id={`${story.id}-title`}>{story.title}</h3>
                    <p className="showcase-example__description">{story.description}</p>
                    <p className="showcase-example__placement"><MapPin size={13} aria-hidden="true" /><span><strong>Де відображається:</strong> {showcasePlacement(story)}</span></p>
                  </div>
                  <IconButton label={`Скопіювати посилання: ${story.title}`} onClick={() => void copyLink(story.id, story.group)}>{copied === story.id ? <Check size={15} /> : <Copy size={15} />}</IconButton>
                </header>
                <div className="showcase-preview">{example.kind === 'card' ? <FeedStoryExample story={example.story} /> : example.story.content}</div>
              </section>
            })}
          </section>)}
          {!cards.length && !support.length && <div className="showcase-empty"><Search size={25} /><h3>Такого стану не знайдено</h3><p>Спробуйте «ознайомлення», «файл», «коментар» або «помилка».</p><Button type="button" variant="secondary" onClick={() => setSearch('')}>Очистити пошук</Button></div>}
        </div>
        {copied && <span className="sr-only" role="status">{copied === 'failed' ? 'Посилання доступне для ручного копіювання в полі над прикладами.' : 'Посилання на приклад скопійовано.'}</span>}
        <footer className="showcase-end"><FlaskConical size={15} /><span>Галерея для обговорення та перевірки дизайну LankaDWS</span><button type="button" onClick={() => window.scrollTo({ top: 0, behavior: 'instant' })}>На початок ↑</button></footer>
      </div>
    </div>
  </div>
}
