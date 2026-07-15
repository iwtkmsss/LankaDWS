import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { copyFileSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import request from 'supertest';
import { resetConfigForTests } from '../../src/config/config.js';
import { configureApp } from '../../src/bootstrap.js';
import { JobsService } from '../../src/modules/jobs/jobs.service.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';

const database = resolve('test/tmp/e2e.db');
let app: INestApplication;

beforeAll(async () => {
  mkdirSync(dirname(database), { recursive: true });
  copyFileSync(resolve('prisma/dev.db'), database);
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = `file:${database.replaceAll('\\', '/')}`;
  process.env.DISABLE_JOB_WORKER = 'true';
  resetConfigForTests();
  const { AppModule } = await import('../../src/app.module.js');
  const module = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  app = module.createNestApplication();
  configureApp(app);
  await app.init();
});

afterAll(async () => {
  await app?.close();
  rmSync(dirname(database), { recursive: true, force: true });
});

async function login(username: string) {
  const agent = request.agent(app.getHttpServer());
  const response = await agent
    .post('/api/v1/auth/login')
    .send({ username, password: 'BertDemoPassphrase2026!' })
    .expect(201);
  expect(response.body.nextStep).toBe('AUTHENTICATED');
  return { agent, csrf: response.body.csrfToken as string };
}

describe('BERT CRM API workflows', () => {
  it('enforces CSRF and company-safe authenticated projections', async () => {
    const { agent } = await login('maria');
    const me = await agent.get('/api/v1/me').expect(200);
    expect(me.body.username).toBe('maria');
    expect(me.body.permissions).toContain('tasks.read');
    await agent.post('/api/v1/auth/logout').expect(403);
    const dashboard = await agent.get('/api/v1/dashboard').expect(200);
    expect(dashboard.body).toHaveProperty('tasks');
    expect(JSON.stringify(dashboard.body)).not.toContain('privateHrComment');
  });

  it('submits an absence idempotently, approves it once, and executes durable effects', async () => {
    const maria = await login('maria');
    const key = `e2e-absence-${Date.now()}`;
    const payload = {
      companyId: 'cmp_bert_ua',
      startDate: '2027-02-08',
      endDate: '2027-02-12',
      substituteId: 'usr_marko',
      privateHrComment: 'Тільки для HR e2e',
    };
    const submitted = await maria.agent
      .post('/api/v1/requests/absence')
      .set('x-csrf-token', maria.csrf)
      .set('idempotency-key', key)
      .send(payload)
      .expect(201);
    const repeated = await maria.agent
      .post('/api/v1/requests/absence')
      .set('x-csrf-token', maria.csrf)
      .set('idempotency-key', key)
      .send(payload)
      .expect(201);
    expect(repeated.body.id).toBe(submitted.body.id);

    const andrii = await login('andrii');
    const approvalKey = `e2e-approval-${Date.now()}`;
    const approved = await andrii.agent
      .post(`/api/v1/requests/${submitted.body.id}/approve`)
      .set('x-csrf-token', andrii.csrf)
      .set('idempotency-key', approvalKey)
      .send({ expectedVersion: 1 })
      .expect(201);
    expect(approved.body.decisionStatus).toBe('APPROVED');
    const repeatedApproval = await andrii.agent
      .post(`/api/v1/requests/${submitted.body.id}/approve`)
      .set('x-csrf-token', andrii.csrf)
      .set('idempotency-key', approvalKey)
      .send({ expectedVersion: 1 })
      .expect(201);
    expect(repeatedApproval.body.decisionStatus).toBe('APPROVED');

    const jobs = app.get(JobsService);
    for (let index = 0; index < 8; index += 1) await jobs.runOnce();
    const detail = await maria.agent
      .get(`/api/v1/requests/${submitted.body.id}`)
      .expect(200);
    expect(detail.body.executionStatus).toBe('SUCCEEDED');
    expect(detail.body.effects).toHaveLength(3);
    expect(
      detail.body.effects.every(
        (effect: { state: string }) => effect.state === 'SUCCEEDED',
      ),
    ).toBe(true);
  });

  it('returns RFC 9457 problems without leaking details across scope', async () => {
    const maria = await login('maria');
    const response = await maria.agent.get('/api/v1/admin').expect(403);
    expect(response.type).toMatch(/problem\+json/);
    expect(response.body).toMatchObject({ status: 403, code: 'forbidden' });
    expect(response.body.correlationId).toBeTruthy();
  });

  it('generates an authorized audit export through the durable queue', async () => {
    const dmytro = await login('dmytro');
    const created = await dmytro.agent
      .post('/api/v1/admin/audit/exports')
      .set('x-csrf-token', dmytro.csrf)
      .set('idempotency-key', `audit-export-${Date.now()}`)
      .expect(201);
    expect(created.body.state).toBe('QUEUED');
    const jobs = app.get(JobsService);
    for (let index = 0; index < 12; index += 1) {
      await jobs.runOnce();
      const current = await dmytro.agent
        .get(`/api/v1/admin/audit/exports/${created.body.exportId}`)
        .expect(200);
      if (current.body.state === 'SUCCEEDED') {
        expect(current.body.fileId).toMatch(/^file_export_/);
        const download = await dmytro.agent
          .get(`/api/v1/files/${current.body.fileId}/download`)
          .expect(200);
        expect(download.headers['content-type']).toMatch(/text\/csv/);
        expect(download.text).toContain('correlationId');
        return;
      }
    }
    throw new Error('Audit export job did not complete');
  });

  it('returns a safe 409 for stale optimistic updates', async () => {
    const maria = await login('maria');
    const response = await maria.agent
      .patch('/api/v1/tasks/tsk_design/status')
      .set('x-csrf-token', maria.csrf)
      .send({ status: 'DONE', expectedVersion: 0 })
      .expect(409);
    expect(response.body).toMatchObject({ status: 409, code: 'version_conflict' });
    expect(JSON.stringify(response.body)).not.toContain('Prisma');
  });

  it('keeps uploads quarantined until the durable scanner job succeeds', async () => {
    const dmytro = await login('dmytro');
    const uploaded = await dmytro.agent
      .post('/api/v1/files?company=cmp_bert_ua')
      .set('x-csrf-token', dmytro.csrf)
      .attach('file', Buffer.from('BERT CRM safe e2e file\n'), {
        filename: 'e2e-note.txt',
        contentType: 'text/plain',
      })
      .expect(201);
    expect(uploaded.body.scanStatus).toBe('QUARANTINED');
    await dmytro.agent
      .get(`/api/v1/files/${uploaded.body.id}/download`)
      .expect(403);
    const jobs = app.get(JobsService);
    for (let index = 0; index < 20; index += 1) {
      await jobs.runOnce();
      const status = await dmytro.agent
        .get(`/api/v1/files/${uploaded.body.id}/status`)
        .expect(200);
      if (status.body.scanStatus === 'CLEAN') {
        const download = await dmytro.agent
          .get(`/api/v1/files/${uploaded.body.id}/download`)
          .expect(200);
        expect(download.text).toContain('safe e2e file');
        return;
      }
    }
    throw new Error('Scanner job did not complete');
  });

  it('recovers an expired job lease after a simulated worker restart', async () => {
    const prisma = app.get(PrismaService);
    const jobId = `job_lease_${Date.now()}`;
    await prisma.backgroundJob.create({
      data: {
        id: jobId,
        type: 'search.index',
        entityType: 'TEST',
        entityId: jobId,
        state: 'RUNNING',
        safePayload: '{}',
        attempts: 1,
        leaseOwner: 'dead-worker',
        leaseUntil: new Date(Date.now() - 10_000),
        idempotencyKey: `lease:${jobId}`,
      },
    });
    await app.get(JobsService).runOnce();
    const recovered = await prisma.backgroundJob.findUniqueOrThrow({
      where: { id: jobId },
    });
    expect(recovered.state).toBe('SUCCEEDED');
    expect(recovered.leaseOwner).toBeNull();
  });

  it('honors an exact legal hold during dry-run and idempotent retention purge', async () => {
    const dmytro = await login('dmytro');
    const prisma = app.get(PrismaService);
    const suffix = Date.now();
    const heldId = `ntf_held_${suffix}`;
    const purgeId = `ntf_purge_${suffix}`;
    for (const notificationId of [heldId, purgeId]) {
      await prisma.notification.create({
        data: {
          id: notificationId,
          recipientId: 'usr_dmytro',
          category: 'TEST',
          safeTitle: 'Retention test',
          safeSnippet: 'Safe metadata',
          entityType: 'TEST',
          entityId: notificationId,
          dedupeKey: `retention:${notificationId}`,
          createdAt: new Date('2020-01-01T00:00:00Z'),
        },
      });
    }
    const reauth = await dmytro.agent
      .post('/api/v1/auth/reauth')
      .set('x-csrf-token', dmytro.csrf)
      .send({ password: 'BertDemoPassphrase2026!' })
      .expect(201);
    await dmytro.agent
      .post('/api/v1/admin/retention/legal-holds')
      .set('x-csrf-token', dmytro.csrf)
      .set('x-reauth-challenge', reauth.body.challengeId)
      .send({
        entityType: 'NOTIFICATION',
        entityId: heldId,
        reason: 'e2e legal requirement',
      })
      .expect(201);
    const preview = await dmytro.agent
      .get(
        '/api/v1/admin/retention/dry-run?category=notifications&cutoff=2021-01-01T00:00:00.000Z',
      )
      .expect(200);
    expect(preview.body).toMatchObject({
      eligibleCount: 1,
      heldCount: 1,
      dryRun: true,
    });
    const requested = await dmytro.agent
      .post('/api/v1/admin/retention/purge')
      .set('x-csrf-token', dmytro.csrf)
      .set('x-reauth-challenge', reauth.body.challengeId)
      .set('idempotency-key', `retention-${suffix}`)
      .send({
        category: 'notifications',
        cutoff: '2021-01-01T00:00:00.000Z',
        expectedCount: 1,
        reason: 'e2e expired metadata',
      })
      .expect(201);
    const repeated = await dmytro.agent
      .post('/api/v1/admin/retention/purge')
      .set('x-csrf-token', dmytro.csrf)
      .set('x-reauth-challenge', reauth.body.challengeId)
      .set('idempotency-key', `retention-${suffix}`)
      .send({
        category: 'notifications',
        cutoff: '2021-01-01T00:00:00.000Z',
        expectedCount: 1,
        reason: 'e2e expired metadata',
      })
      .expect(201);
    expect(repeated.body.jobId).toBe(requested.body.jobId);
    for (let index = 0; index < 10; index += 1)
      await app.get(JobsService).runOnce();
    expect(
      await prisma.notification.findUnique({ where: { id: heldId } }),
    ).not.toBeNull();
    expect(
      await prisma.notification.findUnique({ where: { id: purgeId } }),
    ).toBeNull();
  });

  it('rejects a company identifier outside the authenticated principal scope', async () => {
    const maria = await login('maria');
    await maria.agent.get('/api/v1/tasks?company=cmp_not_allowed').expect(403);
    await maria.agent
      .get('/api/v1/search?q=dashboard&company=cmp_not_allowed')
      .expect(403);
  });

  it('rate-limits repeated invalid authentication attempts without disclosing account state', async () => {
    const agent = request.agent(app.getHttpServer());
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const response = await agent.post('/api/v1/auth/login').send({
        username: `missing-${Date.now()}`,
        password: 'definitely-wrong-password',
      });
      expect(response.status).toBe(401);
    }
    const limited = await agent
      .post('/api/v1/auth/login')
      .send({
        username: `missing-${Date.now()}`,
        password: 'definitely-wrong-password',
      })
      .expect(429);
    expect(limited.body).toMatchObject({ status: 429, code: 'rate_limited' });
  });
});
