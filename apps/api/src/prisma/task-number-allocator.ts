import { Injectable } from '@nestjs/common'
import type { Prisma } from '../generated/prisma/client.js'

const GLOBAL_TASK_NUMBER_SCOPE = 'global'

interface TaskNumberTransactionHost {
  $transaction<Result>(
    callback: (tx: Prisma.TransactionClient) => Promise<Result>,
  ): Promise<Result>
}

@Injectable()
export class TaskNumberAllocator {
  private transactionTail: Promise<void> = Promise.resolve()

  async runInTransaction<Result>(
    prisma: TaskNumberTransactionHost,
    callback: (tx: Prisma.TransactionClient, number: string) => Promise<Result>,
  ): Promise<Result> {
    const previous = this.transactionTail
    let release: () => void = () => undefined
    this.transactionTail = new Promise<void>((resolve) => {
      release = resolve
    })
    await previous
    try {
      return await prisma.$transaction(async (tx) => {
        const number = await this.allocate(tx)
        return callback(tx, number)
      })
    } finally {
      release()
    }
  }

  async allocateAdditional(tx: Prisma.TransactionClient): Promise<string> {
    return this.allocate(tx)
  }

  private async allocate(tx: Prisma.TransactionClient): Promise<string> {
    const rows = await tx.$queryRaw<Array<{ lastNumber: bigint }>>`
      INSERT INTO "TaskNumberSequence" ("scope", "lastNumber", "updatedAt")
      VALUES (${GLOBAL_TASK_NUMBER_SCOPE}, 1, CURRENT_TIMESTAMP)
      ON CONFLICT ("scope") DO UPDATE SET
        "lastNumber" = "TaskNumberSequence"."lastNumber" + 1,
        "updatedAt" = CURRENT_TIMESTAMP
      RETURNING "lastNumber"
    `
    const allocated = rows[0]?.lastNumber
    if (allocated === undefined || allocated < 1n) {
      throw new Error('TaskNumberAllocationFailed')
    }
    return allocated.toString()
  }
}
