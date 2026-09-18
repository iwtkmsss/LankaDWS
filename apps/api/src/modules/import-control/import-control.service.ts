import { Injectable } from '@nestjs/common'
import type { ImportReadinessGate, ImportReadinessView } from '@lankadws/contracts'
import type { AuthPrincipal } from '../../common/request-context.js'
import { PrismaService } from '../../prisma/prisma.service.js'

const unresolvedDecisionGates: ImportReadinessGate[] = [
  {
    id: 'D-011',
    title: 'Політика зберігання raw-експорту',
    status: 'BLOCKING',
    detail: 'Потрібно затвердити строк зберігання, доступ і процедуру видалення сирих пакетів.',
  },
  {
    id: 'D-012',
    title: 'Контракт і схема джерела',
    status: 'BLOCKING',
    detail: 'Потрібно зафіксувати версіонований export contract та schema fingerprint для Bitrix24.',
  },
  {
    id: 'D-020',
    title: 'Глибина історії',
    status: 'BLOCKING',
    detail: 'Потрібно погодити, які історичні дані входять до першої хвилі міграції.',
  },
  {
    id: 'D-023',
    title: 'Ресурси й топологія міграції',
    status: 'BLOCKING',
    detail: 'Потрібні підтверджені worker capacity, object storage та резервне копіювання.',
  },
  {
    id: 'D-024',
    title: 'Мапінг оргструктури',
    status: 'BLOCKING',
    detail: 'Потрібна активна й підписана версія відповідності source org unit → підрозділ Lanka.',
  },
]

@Injectable()
export class ImportControlService {
  constructor(private readonly prisma: PrismaService) {}

  async readiness(principal: AuthPrincipal): Promise<ImportReadinessView> {
    const workspace = { workspaceId: principal.workspaceId }
    const [datasets, sealedDatasets, runs, unresolvedBlockingIssues, activeMappingRows] = await Promise.all([
      this.prisma.importDataset.count({ where: workspace }),
      this.prisma.importDataset.count({ where: { ...workspace, status: 'SEALED' } }),
      this.prisma.importRun.count({ where: { dataset: workspace } }),
      this.prisma.importIssue.count({
        where: {
          severity: 'BLOCKING',
          resolvedAt: null,
          run: { dataset: workspace },
        },
      }),
      this.prisma.sourceCompanyMapping.count({ where: { ...workspace, status: 'ACTIVE' } }),
    ])

    const gates: ImportReadinessGate[] = [
      {
        id: 'CONTROL_PLANE',
        title: 'Контрольна площина імпорту',
        status: 'READY',
        detail: 'Маніфести, запуски, issues, leases, ID maps і append-only journal ізольовані за workspace.',
      },
      ...unresolvedDecisionGates,
    ]

    return {
      state: 'BLOCKED',
      productionApplyAvailable: false,
      controlPlaneVersion: 1,
      checkedAt: new Date().toISOString(),
      counters: { datasets, sealedDatasets, runs, unresolvedBlockingIssues, activeMappingRows },
      gates,
    }
  }
}
