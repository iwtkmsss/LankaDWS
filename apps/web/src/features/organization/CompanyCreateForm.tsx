import { CompanyLogoPicker } from './CompanyLogoPicker'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { UserSearchCombobox, type UserSearchOption } from '../employees/UserSearchCombobox'
import { api, jsonBody } from '../../shared/api/client'
import { personName } from '../../shared/lib/personName'
import { Button } from '../../shared/ui'

export function CompanyCreateForm({ onClose, onCreated }: {
  onClose: () => void
  onCreated: (company: { id: string }) => void
}) {
  const client = useQueryClient()
  const [logoFileId, setLogoFileId] = useState<string | null>(null)
  const [logoBusy, setLogoBusy] = useState(false)
  const [managerId, setManagerId] = useState<string | null>(null)
  const [employeeIds, setEmployeeIds] = useState<string[]>([])
  const [people, setPeople] = useState<UserSearchOption[]>([])
  const rememberPerson = (person: UserSearchOption) => setPeople((current) => [...current.filter((item) => item.id !== person.id), person])
  const selectedIds = [...new Set([...employeeIds, ...(managerId ? [managerId] : [])])]
  const mutation = useMutation({
    mutationFn: (value: object) => api<{ id: string }>('/admin/companies', { method: 'POST', body: jsonBody(value) }),
    onSuccess: (savedCompany) => {
      void client.invalidateQueries({ queryKey: ['companies'] })
      void client.invalidateQueries({ queryKey: ['admin-companies'] })
      void client.invalidateQueries({ queryKey: ['admin-users'] })
      void client.invalidateQueries({ queryKey: ['admin-org-units'] })
      void client.invalidateQueries({ queryKey: ['org-units'] })
      void client.invalidateQueries({ queryKey: ['employees'] })
      onCreated(savedCompany)
      onClose()
    },
  })
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (logoBusy) return
    const data = new FormData(event.currentTarget)
    mutation.mutate({ logoFileId, name: data.get('name'), description: data.get('description'), slug: data.get('slug'), timezone: data.get('timezone'), isActive: data.get('isActive') === 'on', managerId, employeeIds })
  }
  return <>
    <header><span className="eyebrow">Компанія</span><h2>Нова компанія</h2></header>
    <form className="entity-form account-form" onSubmit={submit}>
      <CompanyLogoPicker value={logoFileId} onChange={setLogoFileId} onBusyChange={setLogoBusy} disabled={mutation.isPending} />
      <label className="span-2">Назва<input name="name" required /></label>
      <label className="span-2">Стислий опис<textarea name="description" rows={4} maxLength={320} defaultValue="" placeholder="Чим займається компанія та за що відповідає команда" /></label>
      <label className="span-2">Системний slug<input name="slug" required pattern="[a-z0-9][a-z0-9-]{1,62}" /></label>
      <label className="span-2">Часовий пояс<input name="timezone" required defaultValue="Europe/Kyiv" /></label>
      <label className="check-row span-2"><input type="checkbox" name="isActive" defaultChecked />Компанія активна</label>
      <div className="span-2 admin-org-person-picker">
        <UserSearchCombobox label="Керівник" value={managerId ?? ''} includeAdmins={false}
          onChange={(id) => setManagerId(id || null)} onSelect={rememberPerson} />
        {managerId && <button type="button" className="admin-org-person-picker__clear" aria-label="Очистити керівника" onClick={() => setManagerId(null)}><X size={15} /></button>}
      </div>
      <section className="span-2 admin-org-employees-picker">
        <UserSearchCombobox label="Додати працівника" value="" clearOnSelect includeAdmins={false}
          excludeIds={selectedIds} onSelect={(person) => { rememberPerson(person); setEmployeeIds((ids) => [...ids, person.id]) }} />
        {selectedIds.length > 0 && <div className="admin-org-employees-picker__list">{selectedIds.map((id) => {
          const person = people.find((person) => person.id === id)!
          return <article key={id}><span>{personName(person.displayName).slice(0, 1)}</span><div><strong title={personName(person.displayName)}>{personName(person.displayName)}</strong><small>{person.jobTitle || 'Без посади'}</small><button type="button" aria-label={`Прибрати ${personName(person.displayName)}`} onClick={() => { setEmployeeIds((ids) => ids.filter((value) => value !== id)); if (managerId === id) { setManagerId(null) } }}>Прибрати</button></div></article>
        })}</div>}
        <small>Вибрані працівники та керівник перейдуть до нової компанії. Попередні призначення до підрозділів і керівні ролі буде завершено.</small>
      </section>
      {mutation.isError && <p className="span-2" role="alert">{mutation.error instanceof Error ? mutation.error.message : 'Не вдалося зберегти компанію.'}</p>}
      <Button className="span-2" disabled={logoBusy || mutation.isPending}>Створити компанію</Button>
    </form>
  </>
}
