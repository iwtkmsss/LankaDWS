import { Navigate, useLocation, useParams } from 'react-router-dom'

export default function LegacyRouteRedirectPage() {
  const location = useLocation()
  const { companyId, employeeId } = useParams()
  const params = new URLSearchParams(location.search)

  if (location.pathname.startsWith('/companies') || location.pathname.startsWith('/admin/companies')) {
    if (companyId) params.set('companyId', companyId)
    return <Navigate replace to={`/organization${params.size ? `?${params.toString()}` : ''}`} />
  }

  params.set('view', location.pathname === '/employees/org' ? 'structure' : 'people')
  if (employeeId) params.set('employeeId', employeeId)
  const legacyCompanyId = params.get('company')
  const legacyUnitId = params.get('unit')
  if (legacyCompanyId) {
    params.set('companyId', legacyCompanyId)
    params.delete('company')
  }
  if (legacyUnitId) {
    params.set('unitId', legacyUnitId)
    params.delete('unit')
  }
  return <Navigate replace to={`/organization?${params.toString()}`} />
}
