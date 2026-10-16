import { searchUsers } from '../../common/search-users.js'
import { Injectable } from '@nestjs/common'
import type { ProjectOption, TagOption, TaskOption } from '@lankadws/contracts'
import { id } from '../../common/crypto.js'
import { badRequest, conflict } from '../../common/errors.js'
import { isGlobalAdmin, type AuthPrincipal } from '../../common/request-context.js'
import { PrismaService } from '../../prisma/prisma.service.js'
import { ScopeService } from '../authorization/scope.service.js'

interface TaskOptionsQuery {
  projectId?: string
  search?: string
}

@Injectable()
export class TaskCatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
  ) {}

  async projects(principal: AuthPrincipal, search?: string): Promise<ProjectOption[]> {
    const companyId = this.scope.assertCompany(principal, undefined)
    const projects = await this.prisma.project.findMany({
      where: {
        workspaceId: principal.workspaceId,
        companyId,
        status: 'ACTIVE',
        ...(search?.trim() ? { name: { contains: search.trim() } } : {}),
      },
      select: { id: true, name: true, status: true },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      take: 50,
    })
    return projects.map((project) => ({ ...project, status: 'ACTIVE' }))
  }

  async createProject(principal: AuthPrincipal, rawName: string): Promise<ProjectOption> {
    const name = this.normalizeName(rawName, 120, 'task_project')
    const normalizedName = name.toLocaleLowerCase('uk-UA')
    const companyId = this.scope.assertCompany(principal, undefined)
    const existing = await this.prisma.project.findUnique({
      where: { companyId_normalizedName: { companyId, normalizedName } },
      select: { id: true },
    })
    if (existing) throw conflict('task_project_exists')
    const project = await this.prisma.project.create({
      data: {
        id: id('prj'),
        workspaceId: principal.workspaceId,
        companyId,
        name,
        normalizedName,
      },
      select: { id: true, name: true, status: true },
    })
    return { ...project, status: 'ACTIVE' }
  }

  async tags(principal: AuthPrincipal, search?: string): Promise<TagOption[]> {
    const companyId = this.scope.assertCompany(principal, undefined)
    return this.prisma.tag.findMany({
      where: {
        workspaceId: principal.workspaceId,
        companyId,
        ...(search?.trim() ? { name: { contains: search.trim() } } : {}),
      },
      select: { id: true, name: true, color: true },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      take: 50,
    })
  }

  async createTag(
    principal: AuthPrincipal,
    rawName: string,
    rawColor?: string | null,
  ): Promise<TagOption> {
    const name = this.normalizeName(rawName, 50, 'task_tag')
    const normalizedName = name.toLocaleLowerCase('uk-UA')
    const color = rawColor?.trim() || null
    if (color && !/^#[\da-f]{6}$/i.test(color)) throw badRequest('task_tag_color')
    const companyId = this.scope.assertCompany(principal, undefined)
    const existing = await this.prisma.tag.findUnique({
      where: { companyId_normalizedName: { companyId, normalizedName } },
      select: { id: true },
    })
    if (existing) throw conflict('task_tag_exists')
    return this.prisma.tag.create({
      data: {
        id: id('tag'),
        workspaceId: principal.workspaceId,
        companyId,
        name,
        normalizedName,
        color,
      },
      select: { id: true, name: true, color: true },
    })
  }

  async options(principal: AuthPrincipal, query: TaskOptionsQuery) {
    const companyId = this.scope.assertCompany(principal, undefined)
    const search = query.search?.trim()
    const projectId = query.projectId?.trim() || null
    const [project] = await Promise.all([
      projectId
        ? this.prisma.project.findFirst({
            where: {
              id: projectId,
              workspaceId: principal.workspaceId,
              companyId,
              status: 'ACTIVE',
            },
            select: { id: true },
          })
        : Promise.resolve(null),
    ])
    if (projectId && !project) throw badRequest('task_project')
    const [users, projects, tags, tasks] = await Promise.all([
      searchUsers(this.prisma, principal, search ?? ''),
      this.projects(principal, search),
      this.tags(principal, search),
      this.prisma.task.findMany({
        where: {
          workspaceId: principal.workspaceId,
          companyId,
          ...(projectId ? { projectId } : {}),
          archivedAt: null,
          ...(isGlobalAdmin(principal)
            ? {}
            : {
                OR: [
                  { createdById: principal.userId },
                  { reporterId: principal.userId },
                  {
                    participants: {
                      some: { userId: principal.userId, removedAt: null },
                    },
                  },
                ],
              }),
          ...(search
            ? {
                OR: [
                  { number: { contains: search } },
                  { title: { contains: search } },
                  { legacyNumbers: { some: { legacyNumber: { contains: search } } } },
                ],
              }
            : {}),
        },
        select: {
          id: true,
          number: true,
          title: true,
          status: true,
          projectId: true,
          parentTaskId: true,
        },
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        take: 50,
      }),
    ])
    return {
      users,
      projects,
      tags,
      tasks: tasks satisfies TaskOption[],
    }
  }

  private normalizeName(rawName: string, max: number, code: string): string {
    const name = typeof rawName === 'string' ? rawName.trim() : ''
    if (!name || name.length > max) throw badRequest(code)
    return name
  }
}
