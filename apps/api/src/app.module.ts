import { Module } from '@nestjs/common'
import { APP_FILTER, APP_GUARD } from '@nestjs/core'
import { ProblemFilter } from './common/errors.js'
import { PrismaModule } from './prisma/prisma.module.js'
import { AdminModule } from './modules/admin/admin.module.js'
import { AnalyticsModule } from './modules/analytics/analytics.module.js'
import { AnnouncementsModule } from './modules/announcements/announcements.module.js'
import { AuditModule } from './modules/audit/audit.module.js'
import { AuthModule } from './modules/auth/auth.module.js'
import { SessionAuthGuard } from './modules/auth/auth.guard.js'
import { AuthorizationModule } from './modules/authorization/authorization.module.js'
import { CalendarModule } from './modules/calendar/calendar.module.js'
import { CommunicationModule } from './modules/communication/communication.module.js'
import { DashboardModule } from './modules/dashboard/dashboard.module.js'
import { DocumentsModule } from './modules/documents/documents.module.js'
import { EmployeesModule } from './modules/employees/employees.module.js'
import { FilesModule } from './modules/files/files.module.js'
import { FeedModule } from './modules/feed/feed.module.js'
import { HealthModule } from './modules/health/health.module.js'
import { GroupsModule } from './modules/groups/groups.module.js'
import { JobsModule } from './modules/jobs/jobs.module.js'
import { KnowledgeModule } from './modules/knowledge/knowledge.module.js'
import { ImportControlModule } from './modules/import-control/import-control.module.js'
import { LifecycleModule } from './modules/lifecycle/lifecycle.module.js'
import { RetentionModule } from './modules/retention/retention.module.js'
import { OrgModule } from './modules/org/org.module.js'
import { TasksModule } from './modules/tasks/tasks.module.js'
import { CompaniesModule } from './modules/companies/companies.module.js'

@Module({
  imports: [
    PrismaModule,
    AuthorizationModule,
    AuditModule,
    JobsModule,
    AuthModule,
    TasksModule,
    RetentionModule,
    CalendarModule,
    DocumentsModule,
    FilesModule,
    FeedModule,
    KnowledgeModule,
    ImportControlModule,
    EmployeesModule,
    OrgModule,
    GroupsModule,
    LifecycleModule,
    AnnouncementsModule,
    CommunicationModule,
    AnalyticsModule,
    DashboardModule,
    AdminModule,
    CompaniesModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: SessionAuthGuard },
    { provide: APP_FILTER, useClass: ProblemFilter },
  ],
})
export class AppModule {}
