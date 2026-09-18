import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, Check, CircleAlert, ShieldCheck } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import { api, jsonBody } from '../shared/api/client'
import { UserProfileLink } from '../features/employees/UserProfileDrawer'
import { formatDate, formatDateTime } from '../shared/lib/format'
import { Avatar, Button, Card, ErrorState, PageHeader, Skeleton, StatusBadge } from '../shared/ui'

interface Process { id: string; processType: 'OFFBOARDING'; status: string; progress: number; version: number; startAt: string; endAt?: string | null; employee: { id: string; displayName: string; jobTitle: string; avatarAsset?: string | null } | null; steps: Array<{ id: string; sourceKey: string; linkedTaskId: string; status: string; dueAt: string }> }

export default function LifecyclePage() {
  const { processId } = useParams(); const client = useQueryClient()
  const query = useQuery({ queryKey: ['lifecycle', processId], queryFn: () => api<Process>(`/lifecycle/processes/${processId}`), enabled: Boolean(processId) })
  const complete = useMutation({ mutationFn: () => api(`/lifecycle/processes/${processId}/complete`, { method: 'POST', body: jsonBody({ expectedVersion: query.data?.version, ownershipTransferred: true }) }), onSuccess: () => void client.invalidateQueries({ queryKey: ['lifecycle', processId] }) })
  if (query.isLoading) return <><PageHeader title="Офбординг" /><Skeleton rows={7} /></>
  if (query.isError || !query.data) return <ErrorState />
  const data = query.data
  return <div className="lifecycle-page"><PageHeader title="Офбординг" description="Контрольована передача власності та завершення доступів" /><section className="lifecycle-hero"><div><span className="eyebrow"><ShieldCheck size={15} />Підвищена конфіденційність</span>{data.employee ? <UserProfileLink className="lifecycle-person" userId={data.employee.id}><Avatar size="lg" name={data.employee.displayName} src={data.employee.avatarAsset} /><span><h2>{data.employee.displayName}</h2><p>{data.employee.jobTitle}</p></span></UserProfileLink> : <div className="lifecycle-person"><Avatar size="lg" name="Працівник" /><div><h2>Працівник</h2></div></div>}<div className="progress progress--large"><i style={{ width: `${data.progress}%` }} /></div><strong>{data.progress}% завершено</strong></div><img src="/assets/lifecycle/offboarding-workspace.webp" alt="" width="420" height="280" /></section><div className="lifecycle-layout"><Card><header className="card-title"><h2>Кроки процесу</h2><StatusBadge status={data.status} /></header><ol className="lifecycle-steps">{data.steps.map((step, index) => <li key={step.id} className={step.status === 'DONE' ? 'is-done' : ''}><i>{step.status === 'DONE' ? <Check size={15} /> : index + 1}</i><span><strong>{stepTitle(step.sourceKey)}</strong><small>Строк: {formatDateTime(step.dueAt)}</small></span><StatusBadge status={step.status} /><Link to={`/tasks/${step.linkedTaskId}`}>Відкрити задачу <ArrowRight size={15} /></Link></li>)}</ol></Card><aside aria-label="Підсумок процесу"><Card><h3>Період</h3><p>{formatDate(data.startAt)} {data.endAt ? `— ${formatDate(data.endAt)}` : ''}</p></Card><Card className="blocker-card"><CircleAlert size={20} /><div><h3>Контроль завершення</h3><p>Процес не завершиться, доки критичні об’єкти не матимуть нового власника.</p></div></Card><Button disabled={data.steps.some((step) => step.status !== 'DONE') || complete.isPending} onClick={() => complete.mutate()}>Завершити процес</Button></aside></div></div>
}

function stepTitle(key: string) { const names: Record<string, string> = { APPROVER: 'Передати задачі й документи', IT: 'Завершити сесії та доступи', HR: 'Оформити фінальні документи' }; return names[key] ?? key }
