import { SetMetadata } from '@nestjs/common'

export const PUBLIC_ROUTE = 'lankadws:public'
export const RESTRICTED_ROUTE = 'lankadws:restricted'
export const ADMIN_ONLY = 'lankadws:admin-only'

export const Public = () => SetMetadata(PUBLIC_ROUTE, true)
export const Restricted = () => SetMetadata(RESTRICTED_ROUTE, true)
export const AdminOnly = () => SetMetadata(ADMIN_ONLY, true)
