import { SetMetadata } from '@nestjs/common'

export const PUBLIC_ROUTE = 'bert:public'
export const RESTRICTED_ROUTE = 'bert:restricted'
export const ADMIN_ONLY = 'bert:admin-only'

export const Public = () => SetMetadata(PUBLIC_ROUTE, true)
export const Restricted = () => SetMetadata(RESTRICTED_ROUTE, true)
export const AdminOnly = () => SetMetadata(ADMIN_ONLY, true)
