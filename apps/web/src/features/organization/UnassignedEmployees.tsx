import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import type { OrgUnitView } from '@lankadws/contracts'
import { api } from '../../shared/api/client'
import { personName } from '../../shared/lib/personName'
import { UNASSIGNED_DEPARTMENT_LABEL } from '../../shared/lib/organization'
import { Avatar, Button, ErrorState, Skeleton } from '../../shared/ui'

interface Employee { id: string; displayName: string; jobTitle: string; avatarAsset: string | null }

export function UnassignedEmployees({ companyId, units = [], onAssign, onOpen }: {
  companyId: string
  units?: OrgUnitView[]
  onAssign?: (employee: Employee, unit: OrgUnitView) => void
  onOpen?: (id: string) => void
}) {
  const [cursors, setCursors] = useState<string[]>([])
  const [targetId, setTargetId] = useState('')
  const cursor = cursors.at(-1)
  const query = useQuery({
    queryKey: ['company-unassigned-employees', companyId, cursor ?? ''],
    queryFn: () => api<{ items: Employee[]; total: number; nextCursor: string | null }>(`/org/companies/${encodeURIComponent(companyId)}/unassigned-employees${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`),
  })
  const target = units.find((unit) => unit.id === targetId)
  return <section className="organization-unassigned" aria-label="Працівники без підрозділу">
    <header><h3>{UNASSIGNED_DEPARTMENT_LABEL}</h3>{query.data && <span>{query.data.total}</span>}</header>
    {onAssign && units.length > 0 && <label>Перенести до підрозділу<select value={targetId} onChange={(event) => setTargetId(event.target.value)}><option value="">Оберіть підрозділ</option>{units.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</select></label>}
    {query.isLoading ? <Skeleton rows={3} /> : query.isError ? <ErrorState onRetry={() => void query.refetch()} /> : query.data?.items.length ? <ul>
      {query.data.items.map((employee) => <li key={employee.id} draggable={Boolean(onAssign)} onDragStart={(event) => {
        event.dataTransfer.setData('application/x-lankadws-employee', employee.id)
        event.dataTransfer.effectAllowed = 'move'
      }}>
        {onOpen ? <button className="organization-unassigned__person" type="button" onClick={() => onOpen(employee.id)}><Avatar name={personName(employee.displayName)} src={employee.avatarAsset} /><span><strong>{personName(employee.displayName)}</strong><small>{employee.jobTitle}</small></span></button> : <div className="organization-unassigned__person"><Avatar name={personName(employee.displayName)} src={employee.avatarAsset} /><span><strong>{personName(employee.displayName)}</strong><small>{employee.jobTitle}</small></span></div>}
        {onAssign && <Button type="button" variant="secondary" disabled={!target} aria-label={`Розподілити ${personName(employee.displayName)}`} onClick={() => target && onAssign(employee, target)}>Перенести</Button>}
      </li>)}
    </ul> : <p>{query.data?.total ? 'На цій сторінці більше немає працівників.' : 'Усі працівники розподілені.'}</p>}
    {(cursors.length > 0 || query.data?.nextCursor) && <nav aria-label="Сторінки працівників без підрозділу">
      <Button type="button" variant="secondary" disabled={!cursors.length || query.isLoading} onClick={() => setCursors((current) => current.slice(0, -1))}>Назад</Button>
      <Button type="button" variant="secondary" disabled={!query.data?.nextCursor || query.isLoading} onClick={() => { if (query.data?.nextCursor) setCursors((current) => [...current, query.data!.nextCursor!]) }}>Далі</Button>
    </nav>}
  </section>
}
