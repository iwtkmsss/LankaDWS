# LankaDWS API route map

Generated from `artifacts/openapi.json`. Do not edit manually.

Total operations: **225**

## Admin

| Method | Path | Operation | Summary |
|---|---|---|---|
| `GET` | `/api/v1/admin` | `AdminController_overview` |  |
| `GET` | `/api/v1/admin/audit` | `AdminController_audit` |  |
| `POST` | `/api/v1/admin/audit/exports` | `AdminController_auditExport` |  |
| `GET` | `/api/v1/admin/audit/exports/{id}` | `AdminController_auditExportStatus` |  |
| `POST` | `/api/v1/admin/credential-reset-approvals/{id}/approve` | `AdminController_approveReset` |  |
| `POST` | `/api/v1/admin/credential-reset-approvals/{id}/finalize` | `AdminController_finalizeReset` |  |
| `GET` | `/api/v1/admin/organization/capabilities` | `AdminController_capabilities` |  |
| `PATCH` | `/api/v1/admin/organization/capabilities/{code}` | `AdminController_updateCapability` |  |
| `GET` | `/api/v1/admin/security-policy` | `AdminController_securityPolicy` |  |
| `PATCH` | `/api/v1/admin/security-policy` | `AdminController_updateSecurityPolicy` |  |
| `GET` | `/api/v1/admin/system/jobs` | `AdminController_jobs` |  |
| `POST` | `/api/v1/admin/system/jobs/{id}/retry` | `AdminController_retryJob` |  |
| `GET` | `/api/v1/admin/users` | `AdminController_users` |  |
| `POST` | `/api/v1/admin/users` | `AdminController_createUser` |  |
| `GET` | `/api/v1/admin/users/{id}` | `AdminController_user` |  |
| `PATCH` | `/api/v1/admin/users/{id}` | `AdminController_updateUser` |  |
| `POST` | `/api/v1/admin/users/{id}/avatar` | `AdminController_uploadAvatar` |  |
| `POST` | `/api/v1/admin/users/{id}/deactivate` | `AdminController_deactivate` |  |
| `POST` | `/api/v1/admin/users/{id}/password-reset` | `AdminController_reset` |  |
| `POST` | `/api/v1/admin/users/{id}/unlock` | `AdminController_unlock` |  |

## AdminOrg

| Method | Path | Operation | Summary |
|---|---|---|---|
| `GET` | `/api/v1/admin/companies/{companyId}/org-units` | `AdminOrgController_list` |  |
| `POST` | `/api/v1/admin/companies/{companyId}/org-units` | `AdminOrgController_create` |  |
| `PATCH` | `/api/v1/admin/companies/{companyId}/org-units/{unitId}` | `AdminOrgController_update` |  |
| `POST` | `/api/v1/admin/companies/{companyId}/org-units/{unitId}/archive` | `AdminOrgController_archive` |  |
| `PUT` | `/api/v1/admin/companies/{companyId}/org-units/{unitId}/employees` | `AdminOrgController_assignEmployees` |  |
| `POST` | `/api/v1/admin/companies/{companyId}/org-units/{unitId}/restore` | `AdminOrgController_restore` |  |

## Auth

| Method | Path | Operation | Summary |
|---|---|---|---|
| `POST` | `/api/v1/auth/2fa/challenge` | `AuthController_challenge` |  |
| `POST` | `/api/v1/auth/2fa/confirm` | `AuthController_confirm` |  |
| `POST` | `/api/v1/auth/2fa/setup` | `AuthController_setup` |  |
| `POST` | `/api/v1/auth/first-login/password` | `AuthController_firstLogin` |  |
| `POST` | `/api/v1/auth/login` | `AuthController_login` |  |
| `POST` | `/api/v1/auth/logout` | `AuthController_logout` |  |
| `POST` | `/api/v1/auth/reauth` | `AuthController_reauth` |  |
| `POST` | `/api/v1/auth/recovery-code` | `AuthController_recovery` |  |

## Calendar

| Method | Path | Operation | Summary |
|---|---|---|---|
| `GET` | `/api/v1/calendar/audiences` | `CalendarController_audiences` |  |
| `GET` | `/api/v1/calendar/events` | `CalendarController_events` |  |
| `POST` | `/api/v1/calendar/events` | `CalendarController_createEvent` |  |
| `GET` | `/api/v1/calendar/events/{id}` | `CalendarController_eventDetail` |  |
| `PATCH` | `/api/v1/calendar/events/{id}` | `CalendarController_updateEvent` |  |
| `GET` | `/api/v1/calendar/presence` | `CalendarController_presence` |  |

## Companies

| Method | Path | Operation | Summary |
|---|---|---|---|
| `GET` | `/api/v1/admin/companies` | `CompaniesController_list` |  |
| `POST` | `/api/v1/admin/companies` | `CompaniesController_create` |  |
| `GET` | `/api/v1/admin/companies/{companyId}` | `CompaniesController_detail` |  |
| `PATCH` | `/api/v1/admin/companies/{companyId}` | `CompaniesController_update` |  |
| `POST` | `/api/v1/admin/companies/{companyId}/activate` | `CompaniesController_activate` |  |
| `POST` | `/api/v1/admin/companies/{companyId}/deactivate` | `CompaniesController_deactivate` |  |
| `PATCH` | `/api/v1/admin/companies/{companyId}/manager` | `CompaniesController_updateManager` |  |

## CompanyDirectory

| Method | Path | Operation | Summary |
|---|---|---|---|
| `GET` | `/api/v1/companies` | `CompanyDirectoryController_list` |  |
| `GET` | `/api/v1/companies/{companyId}` | `CompanyDirectoryController_detail` |  |

## Dashboard

| Method | Path | Operation | Summary |
|---|---|---|---|
| `GET` | `/api/v1/dashboard` | `DashboardController_get` |  |

## Documents

| Method | Path | Operation | Summary |
|---|---|---|---|
| `GET` | `/api/v1/documents` | `DocumentsController_list` |  |
| `POST` | `/api/v1/documents` | `DocumentsController_create` |  |
| `GET` | `/api/v1/documents/{id}` | `DocumentsController_detail` |  |
| `POST` | `/api/v1/documents/{id}/archive` | `DocumentsController_archive` |  |
| `POST` | `/api/v1/documents/{id}/publish` | `DocumentsController_publish` |  |
| `POST` | `/api/v1/documents/{id}/restore` | `DocumentsController_restore` |  |
| `POST` | `/api/v1/documents/{id}/versions` | `DocumentsController_addVersion` |  |

## Drive

| Method | Path | Operation | Summary |
|---|---|---|---|
| `GET` | `/api/v1/drive` | `DriveController_list` |  |
| `POST` | `/api/v1/drive/documents/{id}/as-attachment` | `DriveController_asAttachment` |  |
| `POST` | `/api/v1/drive/documents/{id}/move` | `DriveController_moveDocument` |  |
| `POST` | `/api/v1/drive/documents/{id}/rename` | `DriveController_renameDocument` |  |
| `POST` | `/api/v1/drive/folders` | `DriveController_createFolder` |  |
| `GET` | `/api/v1/drive/folders/{id}` | `DriveController_folderDetail` |  |
| `PATCH` | `/api/v1/drive/folders/{id}` | `DriveController_renameFolder` |  |
| `POST` | `/api/v1/drive/folders/{id}/move` | `DriveController_moveFolder` |  |
| `POST` | `/api/v1/drive/folders/{id}/restore` | `DriveController_restoreFolder` |  |
| `POST` | `/api/v1/drive/folders/{id}/trash` | `DriveController_trashFolder` |  |
| `POST` | `/api/v1/drive/import-file` | `DriveController_importFile` |  |
| `GET` | `/api/v1/drive/shares` | `DriveController_listShares` |  |
| `POST` | `/api/v1/drive/shares` | `DriveController_createShare` |  |
| `DELETE` | `/api/v1/drive/shares/{id}` | `DriveController_revokeShare` |  |

## Employees

| Method | Path | Operation | Summary |
|---|---|---|---|
| `GET` | `/api/v1/employees` | `EmployeesController_list` |  |
| `GET` | `/api/v1/employees/{id}` | `EmployeesController_detail` |  |

## Feed

| Method | Path | Operation | Summary |
|---|---|---|---|
| `GET` | `/api/v1/feed` | `FeedController_list` |  |
| `POST` | `/api/v1/feed` | `FeedController_create` |  |
| `DELETE` | `/api/v1/feed/{id}` | `FeedController_archive` |  |
| `GET` | `/api/v1/feed/{id}` | `FeedController_detail` |  |
| `PATCH` | `/api/v1/feed/{id}` | `FeedController_update` |  |
| `POST` | `/api/v1/feed/{id}/acknowledge` | `FeedController_acknowledge` |  |
| `POST` | `/api/v1/feed/{id}/comments` | `FeedController_comment` |  |
| `GET` | `/api/v1/feed/{id}/mention-candidates` | `FeedController_postMentionCandidates` |  |
| `POST` | `/api/v1/feed/{id}/reactions/like` | `FeedController_like` |  |
| `POST` | `/api/v1/feed/attachments` | `FeedController_uploadAttachment` |  |
| `GET` | `/api/v1/feed/audiences` | `FeedController_audiences` |  |
| `GET` | `/api/v1/feed/authors` | `FeedController_authors` |  |
| `GET` | `/api/v1/feed/facets/audiences` | `FeedController_audienceFacets` |  |
| `POST` | `/api/v1/feed/file-shares/{fileId}` | `FeedController_shareFile` |  |
| `DELETE` | `/api/v1/feed/file-shares/{shareId}` | `FeedController_revokeFileShare` |  |
| `GET` | `/api/v1/feed/mention-candidates` | `FeedController_mentionCandidates` |  |
| `POST` | `/api/v1/feed/read` | `FeedController_markRead` |  |
| `GET` | `/api/v1/feed/summary` | `FeedController_summary` |  |

## Files

| Method | Path | Operation | Summary |
|---|---|---|---|
| `POST` | `/api/v1/files` | `FilesController_upload` |  |
| `GET` | `/api/v1/files/{id}/download` | `FilesController_download` |  |
| `GET` | `/api/v1/files/{id}/status` | `FilesController_status` |  |

## Groups

| Method | Path | Operation | Summary |
|---|---|---|---|
| `GET` | `/api/v1/groups` | `GroupsController_list` |  |
| `POST` | `/api/v1/groups` | `GroupsController_create` |  |
| `GET` | `/api/v1/groups/{id}` | `GroupsController_detail` |  |
| `PATCH` | `/api/v1/groups/{id}` | `GroupsController_update` |  |
| `POST` | `/api/v1/groups/{id}/archive` | `GroupsController_archive` |  |
| `POST` | `/api/v1/groups/{id}/join` | `GroupsController_join` |  |
| `POST` | `/api/v1/groups/{id}/leave` | `GroupsController_leave` |  |
| `POST` | `/api/v1/groups/{id}/requests/{requestId}` | `GroupsController_decideRequest` |  |

## Health

| Method | Path | Operation | Summary |
|---|---|---|---|
| `GET` | `/api/v1/health/details` | `HealthController_details` |  |
| `GET` | `/api/v1/health/live` | `HealthController_live` |  |
| `GET` | `/api/v1/health/ready` | `HealthController_ready` |  |

## ImportControl

| Method | Path | Operation | Summary |
|---|---|---|---|
| `GET` | `/api/v1/admin/import/readiness` | `ImportControlController_readiness` |  |

## Knowledge

| Method | Path | Operation | Summary |
|---|---|---|---|
| `GET` | `/api/v1/knowledge/articles` | `KnowledgeController_list` |  |
| `POST` | `/api/v1/knowledge/articles` | `KnowledgeController_create` |  |
| `DELETE` | `/api/v1/knowledge/articles/{slug}` | `KnowledgeController_remove` |  |
| `GET` | `/api/v1/knowledge/articles/{slug}` | `KnowledgeController_detail` |  |
| `PATCH` | `/api/v1/knowledge/articles/{slug}` | `KnowledgeController_update` |  |
| `POST` | `/api/v1/knowledge/articles/{slug}/acknowledge` | `KnowledgeController_acknowledge` |  |

## Lifecycle

| Method | Path | Operation | Summary |
|---|---|---|---|
| `GET` | `/api/v1/lifecycle/processes` | `LifecycleController_list` |  |
| `POST` | `/api/v1/lifecycle/processes` | `LifecycleController_start` |  |
| `GET` | `/api/v1/lifecycle/processes/{id}` | `LifecycleController_detail` |  |
| `POST` | `/api/v1/lifecycle/processes/{id}/complete` | `LifecycleController_complete` |  |

## Me

| Method | Path | Operation | Summary |
|---|---|---|---|
| `GET` | `/api/v1/me` | `MeController_me` |  |
| `DELETE` | `/api/v1/me/avatar` | `MeController_removeAvatar` |  |
| `POST` | `/api/v1/me/avatar` | `MeController_uploadAvatar` |  |
| `GET` | `/api/v1/me/avatar/{fileId}` | `MeController_avatar` |  |
| `GET` | `/api/v1/me/notification-preferences` | `MeController_notificationPreferences` |  |
| `PATCH` | `/api/v1/me/notification-preferences` | `MeController_updateNotificationPreferences` |  |
| `PATCH` | `/api/v1/me/profile` | `MeController_profile` |  |
| `GET` | `/api/v1/me/sessions` | `MeController_sessions` |  |
| `DELETE` | `/api/v1/me/sessions/{id}` | `MeController_revoke` |  |
| `POST` | `/api/v1/me/sessions/revoke-others` | `MeController_revokeOthers` |  |

## Messages

| Method | Path | Operation | Summary |
|---|---|---|---|
| `DELETE` | `/api/v1/messages/{id}` | `MessagesController_deleteMessage` |  |
| `GET` | `/api/v1/messages/{id}` | `MessagesController_message` |  |
| `PATCH` | `/api/v1/messages/{id}` | `MessagesController_editMessage` |  |
| `DELETE` | `/api/v1/messages/{id}/reactions` | `MessagesController_removeReaction` |  |
| `POST` | `/api/v1/messages/{id}/reactions` | `MessagesController_addReaction` |  |
| `GET` | `/api/v1/messages/events` | `MessagesController_globalEvents` |  |
| `POST` | `/api/v1/messages/groups/{groupId}/thread` | `MessagesController_groupThread` |  |
| `GET` | `/api/v1/messages/summary` | `MessagesController_summary` |  |
| `GET` | `/api/v1/messages/threads` | `MessagesController_threads` |  |
| `POST` | `/api/v1/messages/threads` | `MessagesController_createThread` |  |
| `GET` | `/api/v1/messages/threads/{id}` | `MessagesController_detail` |  |
| `POST` | `/api/v1/messages/threads/{id}/attachments` | `MessagesController_uploadAttachment` |  |
| `GET` | `/api/v1/messages/threads/{id}/events` | `MessagesController_events` |  |
| `GET` | `/api/v1/messages/threads/{id}/mention-candidates` | `MessagesController_mentionCandidates` |  |
| `GET` | `/api/v1/messages/threads/{id}/messages` | `MessagesController_messagesPage` |  |
| `POST` | `/api/v1/messages/threads/{id}/messages` | `MessagesController_post` |  |
| `GET` | `/api/v1/messages/threads/{id}/messages/search` | `MessagesController_searchMessages` |  |
| `POST` | `/api/v1/messages/threads/{id}/participants` | `MessagesController_addParticipant` |  |
| `DELETE` | `/api/v1/messages/threads/{id}/participants/{userId}` | `MessagesController_removeParticipant` |  |
| `PUT` | `/api/v1/messages/threads/{id}/participants/{userId}` | `MessagesController_updateParticipant` |  |
| `PUT` | `/api/v1/messages/threads/{id}/preferences` | `MessagesController_updatePreference` |  |
| `GET` | `/api/v1/messages/threads/{id}/preview` | `MessagesController_preview` |  |
| `POST` | `/api/v1/messages/threads/{id}/read` | `MessagesController_markRead` |  |
| `GET` | `/api/v1/messages/users/{id}` | `MessagesController_user` |  |
| `GET` | `/api/v1/messages/users/recommended` | `MessagesController_recommendedUsers` |  |
| `GET` | `/api/v1/messages/users/search` | `MessagesController_searchUsers` |  |

## Notifications

| Method | Path | Operation | Summary |
|---|---|---|---|
| `GET` | `/api/v1/notifications` | `NotificationsController_list` |  |
| `POST` | `/api/v1/notifications` | `NotificationsController_send` |  |
| `PATCH` | `/api/v1/notifications/{id}` | `NotificationsController_read` |  |
| `PATCH` | `/api/v1/notifications/read-all` | `NotificationsController_readAll` |  |
| `GET` | `/api/v1/notifications/summary` | `NotificationsController_summary` |  |

## Org

| Method | Path | Operation | Summary |
|---|---|---|---|
| `GET` | `/api/v1/org/units` | `OrgController_listUnits` |  |
| `GET` | `/api/v1/org/units/{id}/employees` | `OrgController_listEmployees` |  |

## Retention

| Method | Path | Operation | Summary |
|---|---|---|---|
| `GET` | `/api/v1/admin/retention` | `RetentionController_overview` |  |
| `GET` | `/api/v1/admin/retention/dry-run` | `RetentionController_dryRun` |  |
| `POST` | `/api/v1/admin/retention/legal-holds` | `RetentionController_placeHold` |  |
| `POST` | `/api/v1/admin/retention/legal-holds/{id}/release` | `RetentionController_releaseHold` |  |
| `PATCH` | `/api/v1/admin/retention/policies/{category}` | `RetentionController_updatePolicy` |  |
| `POST` | `/api/v1/admin/retention/purge` | `RetentionController_purge` |  |

## SavedViews

| Method | Path | Operation | Summary |
|---|---|---|---|
| `GET` | `/api/v1/saved-views` | `SavedViewsController_list` |  |
| `POST` | `/api/v1/saved-views` | `SavedViewsController_save` |  |
| `DELETE` | `/api/v1/saved-views/{id}` | `SavedViewsController_remove` |  |

## Search

| Method | Path | Operation | Summary |
|---|---|---|---|
| `GET` | `/api/v1/search` | `SearchController_search` |  |

## Tasks

| Method | Path | Operation | Summary |
|---|---|---|---|
| `GET` | `/api/v1/tasks` | `TasksController_list` |  |
| `POST` | `/api/v1/tasks` | `TasksController_create` |  |
| `GET` | `/api/v1/tasks/{id}` | `TasksController_detail` |  |
| `PATCH` | `/api/v1/tasks/{id}` | `TasksController_update` |  |
| `GET` | `/api/v1/tasks/{id}/activity` | `TasksController_activity` |  |
| `POST` | `/api/v1/tasks/{id}/approval-decisions` | `TasksController_decideApproval` |  |
| `GET` | `/api/v1/tasks/{id}/approval-options` | `TasksController_approvalOptions` |  |
| `POST` | `/api/v1/tasks/{id}/approval-requests` | `TasksController_requestApproval` |  |
| `POST` | `/api/v1/tasks/{id}/archive` | `TasksController_archive` |  |
| `POST` | `/api/v1/tasks/{id}/attachments` | `TasksController_uploadAttachment` |  |
| `DELETE` | `/api/v1/tasks/{id}/attachments/{fileId}` | `TasksController_removeAttachment` |  |
| `POST` | `/api/v1/tasks/{id}/checklist` | `TasksController_checklistItem` |  |
| `PUT` | `/api/v1/tasks/{id}/checklist-order` | `TasksController_reorderChecklist` |  |
| `DELETE` | `/api/v1/tasks/{id}/checklist/{itemId}` | `TasksController_removeChecklistItem` |  |
| `PATCH` | `/api/v1/tasks/{id}/checklist/{itemId}` | `TasksController_checklistState` |  |
| `POST` | `/api/v1/tasks/{id}/comments` | `TasksController_comment` |  |
| `POST` | `/api/v1/tasks/{id}/followers` | `TasksController_follow` |  |
| `DELETE` | `/api/v1/tasks/{id}/followers/{userId}` | `TasksController_unfollow` |  |
| `GET` | `/api/v1/tasks/{id}/hierarchy` | `TasksController_hierarchyTree` |  |
| `GET` | `/api/v1/tasks/{id}/mention-candidates` | `TasksController_mentionCandidates` |  |
| `DELETE` | `/api/v1/tasks/{id}/participants/{userId}` | `TasksController_removeParticipant` |  |
| `PUT` | `/api/v1/tasks/{id}/participants/{userId}` | `TasksController_putParticipant` |  |
| `DELETE` | `/api/v1/tasks/{id}/recurrence` | `TasksController_cancelRecurrence` |  |
| `PUT` | `/api/v1/tasks/{id}/recurrence` | `TasksController_setRecurrence` |  |
| `POST` | `/api/v1/tasks/{id}/relations` | `TasksController_addRelation` |  |
| `DELETE` | `/api/v1/tasks/{id}/relations/{relationId}` | `TasksController_removeRelation` |  |
| `POST` | `/api/v1/tasks/{id}/reminders` | `TasksController_createReminder` |  |
| `DELETE` | `/api/v1/tasks/{id}/reminders/{reminderId}` | `TasksController_cancelReminder` |  |
| `PATCH` | `/api/v1/tasks/{id}/status` | `TasksController_changeStatus` |  |
| `POST` | `/api/v1/tasks/{id}/subtasks` | `TasksController_createSubtask` |  |
| `GET` | `/api/v1/tasks/{id}/time-entries` | `TasksController_timeEntries` |  |
| `POST` | `/api/v1/tasks/{id}/time-entries` | `TasksController_addTimeEntry` |  |
| `DELETE` | `/api/v1/tasks/{id}/time-entries/{entryId}` | `TasksController_removeTimeEntry` |  |
| `PATCH` | `/api/v1/tasks/{id}/time-entries/{entryId}` | `TasksController_updateTimeEntry` |  |
| `POST` | `/api/v1/tasks/{id}/timer/start` | `TasksController_startTimer` |  |
| `POST` | `/api/v1/tasks/{id}/timer/stop` | `TasksController_stopTimer` |  |
| `PUT` | `/api/v1/tasks/{id}/user-state` | `TasksController_userState` |  |
| `POST` | `/api/v1/tasks/attachments/staged` | `TasksController_stageAttachment` |  |
| `GET` | `/api/v1/tasks/options` | `TasksController_options` |  |
| `GET` | `/api/v1/tasks/projects` | `TasksController_projects` |  |
| `POST` | `/api/v1/tasks/projects` | `TasksController_createProject` |  |
| `GET` | `/api/v1/tasks/tags` | `TasksController_tags` |  |
| `POST` | `/api/v1/tasks/tags` | `TasksController_createTag` |  |

## UiPreferences

| Method | Path | Operation | Summary |
|---|---|---|---|
| `DELETE` | `/api/v1/me/ui-preferences/{module}/{key}` | `UiPreferencesController_reset` |  |
| `GET` | `/api/v1/me/ui-preferences/{module}/{key}` | `UiPreferencesController_get` |  |
| `PUT` | `/api/v1/me/ui-preferences/{module}/{key}` | `UiPreferencesController_put` |  |
