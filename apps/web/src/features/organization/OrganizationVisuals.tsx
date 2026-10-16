import type { OrgUnitIcon } from '@lankadws/contracts'
import { Building2, Scale, Settings, FileText, Monitor, UsersRound, BriefcaseBusiness, createLucideIcon } from 'lucide-react'
import './organization-visuals.css'

const MoneyBag = createLucideIcon('MoneyBag', [
  ['path', { d: 'M8 3h8l-2 4h-4L8 3Z', key: 'top' }],
  ['path', { d: 'M10 7C9 10 4 12 4 17a4 4 0 0 0 4 4h8a4 4 0 0 0 4-4c0-5-5-7-6-10', key: 'bag' }],
  ['path', { d: 'M14 12h-3a1.5 1.5 0 0 0 0 3h2a1.5 1.5 0 0 1 0 3h-3m2-7v8', key: 'currency' }],
])

const icons = {
  building: { label: 'Будівля', Icon: Building2 },
  scales: { label: 'Ваги', Icon: Scale },
  settings: { label: 'Шестерня', Icon: Settings },
  document: { label: 'Документ', Icon: FileText },
  computer: { label: 'Комп’ютер', Icon: Monitor },
  people: { label: 'Люди', Icon: UsersRound },
  briefcase: { label: 'Портфель', Icon: BriefcaseBusiness },
  tools: { label: 'Фінанси', Icon: MoneyBag },
} satisfies Record<OrgUnitIcon, { label: string; Icon: typeof Building2 }>

export function UnitIcon({ icon, size = 18 }: { icon?: OrgUnitIcon | null; size?: number }) {
  const { Icon } = icons[icon ?? 'building'] ?? icons.building
  return <Icon size={size} aria-hidden />
}

export function UnitIconPicker({ value, onChange }: { value: OrgUnitIcon | null; onChange: (value: OrgUnitIcon | null) => void }) {
  return <fieldset className="organization-icon-picker span-2"><legend>Значок підрозділу</legend>
    <div>{Object.entries(icons).map(([key, { label, Icon }]) => <label key={key} title={label}>
      <input type="radio" name="unitIcon" aria-label={label} value={key} checked={(value ?? 'building') === key} onChange={() => onChange(key as OrgUnitIcon)} />
      <span><Icon size={22} aria-hidden /></span>
    </label>)}</div>
  </fieldset>
}

export function CompanyLogo({ src, size = 22 }: { src?: string | null; size?: number }) {
  return src ? <img className="organization-company-logo" src={src} width={size} height={size} alt="" /> : <Building2 size={size} aria-hidden />
}
