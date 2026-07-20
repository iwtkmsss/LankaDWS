# BERT CRM operations runbook

## Production topology

Запускайте один NestJS API/worker process за trusted TLS reverse proxy. React static build можна віддавати тим самим origin. SQLite DB, clean files, quarantine/temp і encrypted backups мають бути на окремо визначених persistent paths; backup destination — окремий volume або off-host sync. Не запускайте дві writable replicas над одним SQLite file.

Production startup відхиляє localhost origins, development DB/storage paths, weak/default secrets, in-memory DB і `development-clean` scanner. Усі secret values надходять через environment/secret manager; `.env` не комітиться.

## Deploy

1. Зафіксуйте version і maintenance/rollback owner.
2. Виконайте `npm ci`, `npm run prisma:generate`, `npm run lint`, `npm run typecheck`, `npm run test`, `npm run test:integration`, `npm run test:e2e`, `npm run build`.
3. Створіть backup і виконайте `npm run restore:verify`.
4. Зупиніть старий writer/worker або переведіть traffic у maintenance.
5. Один release process виконує `npm run prisma:deploy`.
6. Запустіть API; readiness має залишатися false до перевірки migrations, SQLite та writable storage.
7. Перевірте `/api/v1/health/live`, `/api/v1/health/ready`, login, permission denial, file scan/download і один durable job.
8. Перемкніть traffic і спостерігайте 5xx, latency p95, `SQLITE_BUSY`, WAL, disk, queue age/failures та outbox lag.

Migration failure не дозволяє запускати mixed old/new processes над невідомою schema. Для destructive change використовуйте expand → migrate/backfill → contract або maintenance window з перевіреним restore point.

## Migrations і development reset

Production застосовує тільки `npm run prisma:deploy`. `npm run prisma:migrate` призначений для створення migration у development. Development demo reset: видаліть лише development DB після перевірки абсолютного path, потім `npm run prisma:deploy && npm run prisma:seed`. Production DB ніколи не копіюють або не reset-ять цим способом.

## Backup і restore

Щогодини external scheduler запускає `npm run backup`. Script використовує SQLite online backup API, шифрує DB і кожний clean file AES-256-GCM, створює SHA-256 manifest/correlation ID і зберігає 30 daily та 12 monthly copies. Моніторинг має alert-ити, якщо останній успішний backup старший за 1 годину. Щоквартально відновлюйте копію на staging.

Перевірка без зміни active data:

```bash
npm run restore:verify
npm run restore:verify -- C:\secure-backups\2026-07-15T12-19-23-008Z
```

Incident restore: зупиніть writes; збережіть failed DB/files volume; перевірте manifest і encryption key version; розшифруйте DB/files у fresh directory; виконайте SQLite integrity check та compatible migrations; змініть production paths на restored volume; перевірте login/permissions/files/audit/request workflow; за потреби rotate sessions/secrets; відкрийте traffic і запишіть incident audit. Звичайний admin UI не виконує restore.

RPO target ≤ 1 година, RTO target ≤ 4 години.

## First admin і break-glass

`npm run bert -- admin:create` працює лише коли active full admin відсутній і вимагає masked TTY. Для reset full admin за нормальної роботи потрібні дві різні особи в admin flow. `npm run bert -- admin:recover` дозволений лише коли іншого active full admin немає, installation secret відповідає `BREAK_GLASS_SECRET_HASH`, operator вводить reason та `RECOVER`. Після виконання доставте temporary credential окремим каналом, перевірте audit, rotate installation secret і розслідуйте причину.

Конфігурація завантажується з кореневого `.env`, навіть коли npm workspace виконує команду з `apps/api`; значення, задані середовищем процесу, не перезаписуються. Для первинної конфігурації виконайте `npm run bert -- recovery:hash` у захищеному TTY і підтвердьте `GENERATE`. Команда створює незалежні OS-CSPRNG secrets/keys, Argon2id-хеш recovery secret та development seed password, зберігаючи структуру й несекретні значення `.env`. Відкритий recovery secret показується тільки один раз і має бути одразу перенесений у password manager.

Якщо у `.env` уже є операційні секрети, команда переходить у режим rotation і вимагає точного підтвердження `ROTATE`. Перед цим створіть перевірений backup і захистіть попередні ключі: зміна `SESSION_PEPPER` завершує чинні sessions, а ротація `TOTP_ENCRYPTION_KEY` та `BACKUP_ENCRYPTION_KEY` без окремої re-encryption/retention процедури робить відповідні старі ciphertext або backup недоступними. Після ротації перезапустіть API, виконайте контрольований recovery drill та задокументуйте audit/incident context.

У локальному development дозволена спрощена команда `npm run bert -- admin:dev-reset`: вона використовує постійний `DEMO_SEED_PASSWORD` із `.env`, скидає локальний 2FA, відкликає сесії та записує credential/audit events без видалення CRM-даних. Команда fail-closed при `NODE_ENV=production`; у production використовуйте лише two-person reset або `admin:recover`.

## Secret rotation

Плануйте maintenance. Створіть backup/restore point. Для session/CSRF/file-link secret rotation завершіть active sessions або підтримайте контрольований dual-key window до повного переходу; для TOTP/private-data key потрібна data re-encryption procedure з version metadata; для backup key збережіть попередній ключ до завершення retention старих копій. Ніколи не логувати key values.

## Incidents

- **Disk full:** зупиніть writes/jobs, не видаляйте WAL вручну; звільніть місце за затвердженою retention/backup policy, перевірте integrity та storage manifests, потім readiness.
- **WAL growth / SQLITE_BUSY:** підтвердьте одну writer instance, знайдіть long transaction/reader, зменште job concurrency до 1, виконайте контрольований checkpoint після backup. Не переносіть live DB на network share.
- **Scanner unavailable:** uploads залишаються quarantined, download заборонений. Відновіть adapter, retry failed `file.scan` jobs через admin system, перевірте backlog/quotas. Не позначайте файли CLEAN вручну.
- **Failed/dead-letter job:** перевірте safe error code й aggregate state, усуньте причину, використайте audited retry. Handlers idempotent; не редагуйте payload у БД.
- **Outbox lag:** перевірте worker readiness/lease, DB busy і queue depth. Expired lease повертається в queued state автоматично.
- **Credential incident:** deactivate/suspend user, revoke sessions, admin reset із recent re-auth; full-admin reset — two-person або break-glass. Перевірте credential/audit events.
- **Backup failure:** не перезаписуйте останню valid copy; перевірте free space, destination permissions і key; повторіть backup та restore verification.

## Host/volume migration

Зупиніть writes, створіть і перевірте encrypted backup, перенесіть backup (не live `.db`/WAL), restore-ніть у fresh local volume, налаштуйте absolute production paths та restrictive OS permissions, застосуйте compatible migrations, виконайте smoke і лише потім переключіть DNS/traffic.

## SQLite capacity boundary

Ознаки міграції на server database: тривале write contention/`SQLITE_BUSY` попри короткі транзакції, потреба в кількох writable replicas/HA, network storage, write-heavy workload або multi-region. Prisma та application services є точкою переходу; file storage мігрує окремо через storage boundary.
