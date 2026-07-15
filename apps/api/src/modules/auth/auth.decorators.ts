import { SetMetadata } from '@nestjs/common'

export const PUBLIC_ROUTE = 'bert:public'
export const RESTRICTED_ROUTE = 'bert:restricted'
export const REQUIRED_PERMISSIONS = 'bert:permissions'

export const Public = () => SetMetadata(PUBLIC_ROUTE, true)
export const Restricted = () => SetMetadata(RESTRICTED_ROUTE, true)
export const RequirePermissions = (...permissions: string[]) => SetMetadata(REQUIRED_PERMISSIONS, permissions)
