import { z } from 'zod'

export const driveViewSchema = z.enum(['MY_DRIVE', 'SHARED', 'RECENT', 'TRASH'])
export type DriveView = z.infer<typeof driveViewSchema>

export const driveFileTypeSchema = z.enum(['ALL', 'FOLDER', 'DOCUMENT', 'IMAGE', 'PDF', 'OTHER'])
export type DriveFileType = z.infer<typeof driveFileTypeSchema>

export const drivePeopleFilterSchema = z.enum(['ANYONE', 'ME', 'OTHERS'])
export type DrivePeopleFilter = z.infer<typeof drivePeopleFilterSchema>

export const driveModifiedFilterSchema = z.enum(['ANY', 'TODAY', 'WEEK', 'MONTH', 'YEAR'])
export type DriveModifiedFilter = z.infer<typeof driveModifiedFilterSchema>

export const driveSortSchema = z.enum(['NAME', 'MODIFIED', 'OWNER', 'SIZE'])
export type DriveSort = z.infer<typeof driveSortSchema>

export const driveSortDirectionSchema = z.enum(['ASC', 'DESC'])
export type DriveSortDirection = z.infer<typeof driveSortDirectionSchema>

export const driveShareTargetTypeSchema = z.enum(['DOCUMENT', 'FOLDER'])
export type DriveShareTargetType = z.infer<typeof driveShareTargetTypeSchema>

export const drivePrincipalTypeSchema = z.enum(['USER', 'GROUP'])
export type DrivePrincipalType = z.infer<typeof drivePrincipalTypeSchema>

export const driveShareRoleSchema = z.enum(['VIEWER', 'EDITOR'])
export type DriveShareRole = z.infer<typeof driveShareRoleSchema>

export const driveListQuerySchema = z.object({
  view: driveViewSchema.default('MY_DRIVE'),
  folderId: z.string().trim().min(1).max(120).optional(),
  search: z.string().trim().max(200).optional(),
  type: driveFileTypeSchema.default('ALL'),
  people: drivePeopleFilterSchema.default('ANYONE'),
  modified: driveModifiedFilterSchema.default('ANY'),
  sort: driveSortSchema.default('MODIFIED'),
  direction: driveSortDirectionSchema.default('DESC'),
})
export type DriveListQuery = z.infer<typeof driveListQuerySchema>

export const driveBreadcrumbSchema = z.object({
  id: z.string(),
  name: z.string(),
})
export type DriveBreadcrumb = z.infer<typeof driveBreadcrumbSchema>

export const driveFolderItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  parentId: z.string().nullable(),
  companyId: z.string(),
  ownerId: z.string(),
  ownerName: z.string(),
  isOwner: z.boolean(),
  sharedWithCount: z.number().int().nonnegative(),
  childCount: z.number().int().nonnegative(),
  updatedAt: z.string(),
  trashedAt: z.string().nullable(),
})
export type DriveFolderItem = z.infer<typeof driveFolderItemSchema>

export const driveFileItemSchema = z.object({
  id: z.string(),
  number: z.string(),
  name: z.string(),
  companyId: z.string(),
  folderId: z.string().nullable(),
  fileId: z.string().nullable(),
  mimeType: z.string().nullable(),
  fileType: z.enum(['DOCUMENT', 'IMAGE', 'PDF', 'OTHER']),
  sizeBytes: z.number().int().nonnegative().nullable(),
  ownerId: z.string(),
  ownerName: z.string(),
  isOwner: z.boolean(),
  sharedWithCount: z.number().int().nonnegative(),
  version: z.number().int().positive(),
  versionCount: z.number().int().nonnegative(),
  updatedAt: z.string(),
  trashedAt: z.string().nullable(),
})
export type DriveFileItem = z.infer<typeof driveFileItemSchema>

export const driveListResultSchema = z.object({
  breadcrumbs: z.array(driveBreadcrumbSchema),
  folders: z.array(driveFolderItemSchema),
  files: z.array(driveFileItemSchema),
  counts: z.object({
    MY_DRIVE: z.number().int().nonnegative(),
    SHARED: z.number().int().nonnegative(),
    RECENT: z.number().int().nonnegative(),
    TRASH: z.number().int().nonnegative(),
  }),
})
export type DriveListResult = z.infer<typeof driveListResultSchema>

export const createDriveFolderSchema = z.object({
  name: z.string().trim().min(1).max(120),
  parentId: z.string().trim().min(1).max(120).nullable().optional(),
})
export type CreateDriveFolderInput = z.infer<typeof createDriveFolderSchema>

export const renameDriveFolderSchema = z.object({
  name: z.string().trim().min(1).max(120),
})
export type RenameDriveFolderInput = z.infer<typeof renameDriveFolderSchema>

export const renameDriveDocumentSchema = z.object({
  name: z.string().trim().min(1).max(200),
  expectedVersion: z.number().int().positive(),
})
export type RenameDriveDocumentInput = z.infer<typeof renameDriveDocumentSchema>

export const moveDriveFolderSchema = z.object({
  parentId: z.string().trim().min(1).max(120).nullable(),
})
export type MoveDriveFolderInput = z.infer<typeof moveDriveFolderSchema>

export const moveDriveDocumentSchema = z.object({
  folderId: z.string().trim().min(1).max(120).nullable(),
  expectedVersion: z.number().int().positive(),
})
export type MoveDriveDocumentInput = z.infer<typeof moveDriveDocumentSchema>

export const importDriveFileSchema = z.object({
  fileId: z.string().trim().min(1).max(120),
  name: z.string().trim().min(1).max(200).optional(),
  folderId: z.string().trim().min(1).max(120).nullable().optional(),
})
export type ImportDriveFileInput = z.infer<typeof importDriveFileSchema>

export const createDriveShareSchema = z.object({
  targetType: driveShareTargetTypeSchema,
  targetId: z.string().trim().min(1).max(120),
  principalType: drivePrincipalTypeSchema,
  principalId: z.string().trim().min(1).max(120),
  role: driveShareRoleSchema.default('VIEWER'),
})
export type CreateDriveShareInput = z.infer<typeof createDriveShareSchema>

export const driveShareViewSchema = z.object({
  id: z.string(),
  targetType: driveShareTargetTypeSchema,
  targetId: z.string(),
  principalType: drivePrincipalTypeSchema,
  principalId: z.string(),
  principalName: z.string(),
  role: driveShareRoleSchema,
  inherited: z.boolean(),
  createdAt: z.string(),
})
export type DriveShareView = z.infer<typeof driveShareViewSchema>
