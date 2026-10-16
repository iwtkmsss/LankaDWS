import { useId } from 'react'

export function OrganizationSearchEmptyState() {
  const id = useId()
  return <div className="empty-state empty-state--illustrated organization-search-empty">
    <svg className="organization-search-empty__illustration" viewBox="0 0 240 180" width="240" height="180" aria-hidden="true">
      <defs>
        <linearGradient id={`${id}-folder`} x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="var(--surface-raised)" />
          <stop offset="1" stopColor="var(--cobalt-100)" />
        </linearGradient>
        <linearGradient id={`${id}-lens`} x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#9db7ff" />
          <stop offset="1" stopColor="#416be0" />
        </linearGradient>
      </defs>
      <rect x=".5" y=".5" width="239" height="179" rx="28" fill="var(--surface-soft)" stroke="var(--line)" />
      <circle cx="127" cy="85" r="62" fill="var(--cobalt-100)" opacity=".35" />
      <ellipse cx="126" cy="143" rx="64" ry="6" fill="var(--ink-900)" opacity=".07" />
      <path d="M111 79h23l9 11h33a9 9 0 0 1 9 9v31a10 10 0 0 1-10 10h-64a10 10 0 0 1-10-10V89a10 10 0 0 1 10-10Z" fill="var(--cobalt-300)" />
      <rect x="110" y="95" width="65" height="43" rx="7" fill="var(--surface-raised)" stroke="var(--line-strong)" />
      <path d="M99 110a8 8 0 0 1 8-8h68a8 8 0 0 1 8 9l-4 23a8 8 0 0 1-8 7h-68a8 8 0 0 1-8-9Z" fill={`url(#${id}-folder)`} stroke="var(--line-strong)" />
      <path d="m93 108-27 29" stroke="#3458bb" strokeWidth="15" strokeLinecap="round" />
      <path d="m91 110-25 27" stroke={`url(#${id}-lens)`} strokeWidth="10" strokeLinecap="round" />
      <circle cx="115" cy="84" r="32" fill="var(--surface)" fillOpacity=".8" stroke="#3458bb" strokeWidth="9" />
      <circle cx="114" cy="82" r="31" fill="none" stroke={`url(#${id}-lens)`} strokeWidth="6" />
      <path d="M98 79a18 18 0 0 1 15-15" fill="none" stroke="var(--cobalt-700)" strokeOpacity=".45" strokeWidth="4" strokeLinecap="round" />
      <circle cx="181" cy="139" r="6" fill="#f18b70" />
      <path d="M177 49v8m-4-4h8M57 87v6m-3-3h6" stroke="var(--cobalt-700)" strokeOpacity=".55" strokeWidth="2" strokeLinecap="round" />
      <circle cx="160" cy="37" r="2" fill="var(--cobalt-700)" opacity=".5" />
    </svg>
    <h2>Нікого не знайдено</h2>
    <p>Змініть локальні фільтри або пошуковий запит.</p>
  </div>
}
