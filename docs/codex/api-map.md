# LankaDWS API route map

Generated from `artifacts/openapi.json`. Do not edit manually.

Total operations: **231**

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
| `DELETE` | `/api/v1/calendar/events/{id}` | `CalendarController_deleteEvent` |  |
| `GET` | `/api/v1/calendar/events/{id}` | `CalendarController_eventDetail` |  |
| `PATCH` | `/api/v1/calendar/events/{id}` | `CalendarController_updateEvent` |  |
| `POST` | `/api/v1/calendar/events/{id}/acknowledge` | `CalendarController_acknowledgeEvent` |  |
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
| `POST` | `/api/v1/admin/companies/logo-uploads` | `CompaniesController_uploadLogo` |  |

## CompanyDirectory

| Method | Path | Operation | Summary |
|---|---|---|---|
| `GET` | `/api/v1/companies` | `CompanyDirectoryController_list` |  |
| `GET` | `/api/v1/companies/{companyId}` | `CompanyDirectoryController_detail` |  |
| `GET` | `/api/v1/companies/{companyId}/logo/{fileId}` | `CompanyDirectoryController_logo` |  |

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

## Drive

| Method | Path | Operation | Summary |
|---|---|---|---|
| `GET` | `/api/v1/drive` | `DriveController_list` |  |
| `GET` | `/api/v1/drive/destinations` | `DriveController_destinations` |  |
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
| `GET` | `/api/v1/drive/owners` | `DriveController_owners` |  |
| `GET` | `/api/v1/drive/picker` | `DriveController_picker` |  |
| `GET` | `/api/v1/drive/shares` | `DriveController_listShares` |  |
| `POST` | `/api/v1/drive/shares` | `DriveController_createShare` |  |
| `DELETE` | `/api/v1/drive/shares/{id}` | `DriveController_revokeShare` |  |

## Employees

| Method | Path | Operation | Summary |
|---|---|---|---|
| `GET` | `/api/v1/employees` | `EmployeesController_list` |  |
| `GET` | `/api/v1/employees/{id}` | `EmployeesController_detail` |  |
| `POST` | `/api/v1/employees/search` | `EmployeesController_search` |  |

## Feed

| Method | Path | Operation | Summary |
|---|---|---|---|
| `GET` | `/api/v1/feed` | `FeedController_list` |  |
| `POST` | `/api/v1/feed` | `FeedController_create` |  |
| `DELETE` | `/api/v1/feed/{id}` | `FeedController_archive` |  |
| `GET` | `/api/v1/feed/{id}` | `FeedController_detail` |  |
| `PATCH` | `/api/v1/feed/{id}` | `FeedController_update` |  |
| `POST` | `/api/v1/feed/{id}/acknowledge` | `FeedController_acknowledge` |  |
| `POST` | `/api/v1/feed/{id}/comment-attachments` | `FeedController_uploadCommentAttachment` |  |
| `POST` | `/api/v1/feed/{id}/comments` | `FeedController_comment` |  |
| `GET` | `/api/v1/feed/{id}/mention-candidates` | `FeedController_postMentionCandidates` |  |
| `POST` | `/api/v1/feed/{id}/reactions/like` | `FeedController_like` |  |
| `POST` | `/api/v1/feed/attachments` | `FeedController_uploadAttachment` |  |
| `GET` | `/api/v1/feed/audiences` | `FeedController_audiences` |  |
| `GET` | `/api/v1/feed/authors` | `FeedController_authors` |  |
| `DELETE` | `/api/v1/feed/events/{id}/pin` | `FeedController_unpinEvent` |  |
| `POST` | `/api/v1/feed/events/{id}/pin` | `FeedController_pinEvent` |  |
| `GET` | `/api/v1/feed/facets/audiences` | `FeedController_audienceFacets` |  |
| `DELETE` | `/api/v1/feed/file-shares/{shareId}` | `FeedController_revokeFileShare` |  |
| `GET` | `/api/v1/feed/mention-candidates` | `FeedController_mentionCandidates` |  |
| `DELETE` | `/api/v1/feed/posts/{id}/pin` | `FeedController_unpinPost` |  |
| `POST` | `/api/v1/feed/posts/{id}/pin` | `FeedController_pinPost` |  |
| `POST` | `/api/v1/feed/read` | `FeedController_markRead` |  |
| `GET` | `/api/v1/feed/summary` | `FeedController_summary` |  |
| `DELETE` | `/api/v1/feed/tasks/{id}/pin` | `FeedController_unpin` |  |
| `POST` | `/api/v1/feed/tasks/{id}/pin` | `FeedController_pin` |  |

## FeedbackTickets

| Method | Path | Operation | Summary |
|---|---|---|---|
| `GET` | `/api/v1/knowledge/tickets` | `FeedbackTicketsController_list` |  |
| `POST` | `/api/v1/knowledge/tickets` | `FeedbackTicketsController_create` |  |
| `DELETE` | `/api/v1/knowledge/tickets/{id}` | `FeedbackTicketsController_remove` |  |
| `GET` | `/api/v1/knowledge/tickets/{id}` | `FeedbackTicketsController_detail` |  |
| `POST` | `/api/v1/knowledge/tickets/attachments` | `FeedbackTicketsController_upload` |  |

## Files

| Method | Path | Operation | Summary |
|---|---|---|---|
| `POST` | `/api/v1/files` | `FilesController_upload` |  |
| `GET` | `/api/v1/files/{id}/download` | `FilesController_download` |  |
| `DELETE` | `/api/v1/files/{id}/draft` | `FilesController_discardDraft` |  |
| `GET` | `/api/v1/files/{id}/preview` | `FilesController_preview` |  |
| `GET` | `/api/v1/files/{id}/status` | `FilesController_status` |  |
| `GET` | `/api/v1/files/archive` | `FilesController_archive` |  |

## Health

| Method | Path | Operation | Summary |
|---|---|---|---|
| `GET` | `/api/v1/health/details` | `HealthController_details` |  |
| `GET` | `/api/v1/health/live` | `HealthController_live` |  |
| `GET` | `/api/v1/health/ready` | `HealthController_ready` |  |

## Knowledge

| Method | Path | Operation | Summary |
|---|---|---|---|
| `GET` | `/api/v1/knowledge/articles` | `KnowledgeController_list` |  |
| `POST` | `/api/v1/knowledge/articles` | `KnowledgeController_create` |  |
| `DELETE` | `/api/v1/knowledge/articles/{slug}` | `KnowledgeController_remove` |  |
| `GET` | `/api/v1/knowledge/articles/{slug}` | `KnowledgeController_detail` |  |
| `PATCH` | `/api/v1/knowledge/articles/{slug}` | `KnowledgeController_update` |  |
| `POST` | `/api/v1/knowledge/articles/{slug}/acknowledge` | `KnowledgeController_acknowledge` |  |
| `GET` | `/api/v1/knowledge/articles/summary` | `KnowledgeController_summary` |  |

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
| `GET` | `/api/v1/messages/{id}/attachments/archive` | `MessagesController_archiveAttachments` |  |
| `DELETE` | `/api/v1/messages/{id}/reactions` | `MessagesController_removeReaction` |  |
| `GET` | `/api/v1/messages/{id}/reactions` | `MessagesController_reactionUsers` |  |
| `POST` | `/api/v1/messages/{id}/reactions` | `MessagesController_addReaction` |  |
| `GET` | `/api/v1/messages/events` | `MessagesController_globalEvents` |  |
| `GET` | `/api/v1/messages/summary` | `MessagesController_summary` |  |
| `GET` | `/api/v1/messages/threads` | `MessagesController_threads` |  |
| `POST` | `/api/v1/messages/threads` | `MessagesController_createThread` |  |
| `GET` | `/api/v1/messages/threads/{id}` | `MessagesController_detail` |  |
| `POST` | `/api/v1/messages/threads/{id}/attachments` | `MessagesController_uploadAttachment` |  |
| `GET` | `/api/v1/messages/threads/{id}/mention-candidates` | `MessagesController_mentionCandidates` |  |
| `GET` | `/api/v1/messages/threads/{id}/messages` | `MessagesController_messagesPage` |  |
| `POST` | `/api/v1/messages/threads/{id}/messages` | `MessagesController_post` |  |
| `GET` | `/api/v1/messages/threads/{id}/messages/search` | `MessagesController_searchMessages` |  |
| `POST` | `/api/v1/messages/threads/{id}/participants` | `MessagesController_addParticipant` |  |
| `DELETE` | `/api/v1/messages/threads/{id}/participants/{userId}` | `MessagesController_removeParticipant` |  |
| `PUT` | `/api/v1/messages/threads/{id}/participants/{userId}` | `MessagesController_updateParticipant` |  |
| `PUT` | `/api/v1/messages/threads/{id}/pin` | `MessagesController_setPin` |  |
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
| `PATCH` | `/api/v1/notifications/{id}` | `NotificationsController_read` |  |
| `PATCH` | `/api/v1/notifications/read-all` | `NotificationsController_readAll` |  |
| `PATCH` | `/api/v1/notifications/read-entity` | `NotificationsController_readEntity` |  |
| `GET` | `/api/v1/notifications/summary` | `NotificationsController_summary` |  |
| `GET` | `/api/v1/notifications/tasks-summary` | `NotificationsController_taskSummary` |  |

## Org

| Method | Path | Operation | Summary |
|---|---|---|---|
| `GET` | `/api/v1/org/companies/{id}/unassigned-employees` | `OrgController_listUnassignedEmployees` |  |
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
| `POST` | `/api/v1/tasks/{id}/archive` | `TasksController_archive` |  |
| `POST` | `/api/v1/tasks/{id}/attachments` | `TasksController_uploadAttachment` |  |
| `DELETE` | `/api/v1/tasks/{id}/attachments/{fileId}` | `TasksController_removeAttachment` |  |
| `POST` | `/api/v1/tasks/{id}/attachments/from-drive` | `TasksController_attachDriveFile` |  |
| `POST` | `/api/v1/tasks/{id}/checklist` | `TasksController_checklistItem` |  |
| `PUT` | `/api/v1/tasks/{id}/checklist-order` | `TasksController_reorderChecklist` |  |
| `DELETE` | `/api/v1/tasks/{id}/checklist/{itemId}` | `TasksController_removeChecklistItem` |  |
| `PATCH` | `/api/v1/tasks/{id}/checklist/{itemId}` | `TasksController_checklistState` |  |
| `POST` | `/api/v1/tasks/{id}/comments` | `TasksController_comment` |  |
| `DELETE` | `/api/v1/tasks/{id}/comments/{commentId}` | `TasksController_deleteComment` |  |
| `PATCH` | `/api/v1/tasks/{id}/comments/{commentId}` | `TasksController_updateComment` |  |
| `DELETE` | `/api/v1/tasks/{id}/comments/{commentId}/reactions` | `TasksController_removeCommentReaction` |  |
| `GET` | `/api/v1/tasks/{id}/comments/{commentId}/reactions` | `TasksController_commentReactionUsers` |  |
| `POST` | `/api/v1/tasks/{id}/comments/{commentId}/reactions` | `TasksController_addCommentReaction` |  |
| `POST` | `/api/v1/tasks/{id}/delegate` | `TasksController_delegate` |  |
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
| `POST` | `/api/v1/tasks/{id}/subtasks` | `TasksController_createSubtask` |  |
| `GET` | `/api/v1/tasks/{id}/time-entries` | `TasksController_timeEntries` |  |
| `POST` | `/api/v1/tasks/{id}/time-entries` | `TasksController_addTimeEntry` |  |
| `DELETE` | `/api/v1/tasks/{id}/time-entries/{entryId}` | `TasksController_removeTimeEntry` |  |
| `PATCH` | `/api/v1/tasks/{id}/time-entries/{entryId}` | `TasksController_updateTimeEntry` |  |
| `POST` | `/api/v1/tasks/{id}/timer/start` | `TasksController_startTimer` |  |
| `POST` | `/api/v1/tasks/{id}/timer/stop` | `TasksController_stopTimer` |  |
| `POST` | `/api/v1/tasks/{id}/transitions` | `TasksController_transition` |  |
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

