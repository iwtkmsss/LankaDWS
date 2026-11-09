# Розгортання LankaDWS

Один процес Node (API і фонові задачі) на `127.0.0.1:3000`, SQLite і файли на локальному диску.
Фронтенд — статика з `apps/web/dist`. Реверс-проксі (nginx) віддає статику, усе з `/api/`
проксює на `127.0.0.1:3000`; для чату там є server-sent events, тож для `/api/` вимкніть
буферизацію (`proxy_buffering off`).

## Встановлення

```bash
git clone https://github.com/iwtkmsss/LankaDWS.git /opt/lankadws
cd /opt/lankadws
cp deploy/production.env.example .env      # домен, шляхи, режим (див. нижче)
npm ci
env NODE_ENV=development npm run lankadws -- recovery:hash   # генерує секрети в .env
npm run build
```

`recovery:hash` показує одноразовий recovery secret — збережіть його.
`NODE_ENV=development` потрібен лише цій команді, у `.env` лишається `production`.

Запуск: `deploy/systemd/lankadws.service` → `/etc/systemd/system/`, далі
`systemctl enable --now lankadws`. Щогодинний backup — `lankadws-backup.service` і `.timer`.

## Варіант 1. Демо

У `.env`: `VITE_DEMO_MODE=true` і `DEMO_SEED_PASSWORD=<пароль демо-акаунтів>`. Потім:

```bash
npm run build          # збірка з паролем на екрані входу
npm run demo:seed      # демо-організація, задачі, стрічка, акаунти maria, andrii, olena, dmytro (адмін), marko
systemctl restart lankadws
```

На екрані входу видно акаунти й пароль, у демо можна робити що завгодно.

## Варіант 2. Справжня робота

У `.env`: `VITE_DEMO_MODE=false`, рядок `DEMO_SEED_PASSWORD` приберіть. Потім:

```bash
systemctl stop lankadws
npm run db:wipe        # зносить базу й файли (backup не чіпає) і створює порожню базу
npm run build          # збірка без демо-паролів
npm run admin:create   # перший адміністратор, далі він сам створює користувачів
systemctl start lankadws
```

## Оновлення

```bash
cd /opt/lankadws && git pull && npm ci && npm run build
systemctl stop lankadws && npm run prisma:deploy && systemctl start lankadws
```

Перевірка: `curl http://127.0.0.1:3000/api/v1/health/ready`.
Backup, відновлення та інциденти — [docs/operations-runbook.md](../docs/operations-runbook.md).
