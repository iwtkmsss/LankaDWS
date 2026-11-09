# Розгортання LankaDWS на сервері (Node + systemd + Caddy)

Інструкція для Linux-сервера (команди наведені для Ubuntu/Debian) зі своїм доменом і HTTPS.
Схема: один процес NestJS (API і фонові задачі) на `127.0.0.1:3000`, SQLite і файли на
локальному диску, Caddy віддає зібраний фронтенд, проксює `/api` і сам отримує сертифікат
Let's Encrypt.

```text
Інтернет ──443──> Caddy ──┬── /api/*  ──> node (lankadws.service, 127.0.0.1:3000) ──> SQLite + файли
                          └── решта   ──> /opt/lankadws/apps/web/dist (SPA)
```

Файли в цій папці:

| Файл | Куди |
|---|---|
| `production.env.example` | шаблон для `/opt/lankadws/.env` |
| `systemd/lankadws.service` | `/etc/systemd/system/` — сам застосунок |
| `systemd/lankadws-backup.service`, `.timer` | `/etc/systemd/system/` — щогодинний зашифрований backup |
| `caddy/Caddyfile` | `/etc/caddy/Caddyfile` — HTTPS, статика, проксі |
| `clamav/compose.yaml` | сканер завантажених файлів (Docker), див. [file-scanning.md](../docs/file-scanning.md) |

## 1. Що потрібно на сервері

- Node.js 24+ і npm 11+ (наприклад, з NodeSource);
- `git`, `build-essential`, `python3` (на випадок, якщо `better-sqlite3` збиратиметься з вихідного коду);
- Caddy (`apt install caddy` з офіційного репозиторію Caddy);
- домен, A/AAAA-запис якого вказує на сервер, відкриті порти 80 і 443;
- для перевірки файлів — ClamAV: Docker + `deploy/clamav/compose.yaml` (≈4 ГБ RAM додатково)
  або пакет `clamav-daemon`, що слухає TCP `127.0.0.1:3310`. Без сканера застосунок працює з
  `MALWARE_SCANNER=unavailable`, але завантажені файли лишаються в карантині й не скачуються.

## 2. Користувач і папки

```bash
sudo useradd --system --create-home --home-dir /var/lib/lankadws --shell /usr/sbin/nologin lankadws
sudo mkdir -p /opt/lankadws /var/lib/lankadws/{db,files,quarantine,tmp} /var/backups/lankadws
sudo chown -R lankadws:lankadws /opt/lankadws /var/lib/lankadws /var/backups/lankadws
sudo chmod 750 /var/lib/lankadws /var/backups/lankadws
```

## 3. Код і конфігурація

```bash
sudo -u lankadws git clone --branch v1.0.0 https://github.com/iwtkmsss/LankaDWS.git /opt/lankadws
cd /opt/lankadws
sudo -u lankadws cp deploy/production.env.example .env
sudo -u lankadws chmod 600 .env
sudo -u lankadws nano .env        # домен у FRONTEND_ORIGIN / FRONTEND_BASE_URL, MALWARE_SCANNER
```

Секрети генерує сам застосунок (запустіть у звичайному терміналі, він попросить ввести `GENERATE`):

```bash
sudo -u lankadws npm ci
sudo -u lankadws env NODE_ENV=development npm run lankadws -- recovery:hash
```

`NODE_ENV=development` тут потрібен лише цій одній команді: у production-режимі перевірка
конфігурації відхиляє заглушки секретів ще до того, як команда встигне їх замінити. Змінна
процесу не потрапляє в `.env`, там лишається `NODE_ENV=production`.

Команда:

- записує в `.env` усі секрети і, крім того, випадковий `DEMO_SEED_PASSWORD` (пароль демо-акаунтів
  для тестового стенду; на справжній інсталяції видаліть цей рядок);
- показує **одноразовий recovery secret** — одразу збережіть його в менеджер паролів, він більше
  ніде не з'явиться (потрібен для аварійного відновлення адміністратора).

## 4. Збірка і база

```bash
sudo -u lankadws npm run build
sudo -u lankadws npm run prisma:deploy
```

## 5. Дані: тестова інсталяція або справжня

**Тестові дані однією командою.** `DEMO_SEED_PASSWORD` уже записав `recovery:hash`
(подивитися: `sudo grep DEMO_SEED_PASSWORD /opt/lankadws/.env`); можна замінити своїм, 12+ символів,
пароль із репозиторію відхиляється. Потім:

```bash
sudo -u lankadws npm run demo:seed
```

Команда застосовує міграції й створює демо-організацію з підрозділами, задачами, стрічкою та
акаунтами `maria`, `andrii`, `olena`, `dmytro` (глобальний адміністратор), `marko` — усі з паролем
`DEMO_SEED_PASSWORD`. Повторний запуск безпечний: він оновлює ті самі записи. Якщо в базі вже є
будь-який не-демо користувач, команда нічого не змінює й завершується з помилкою.

Демо-акаунти доступні з інтернету: не тримайте такий стенд відкритим довше, ніж потрібно.

**Справжня інсталяція.** На порожній базі створіть першого адміністратора (пароль вводиться
в терміналі, не в аргументах):

```bash
sudo -u lankadws npm run lankadws -- admin:create
```

Щоб перейти з тестової інсталяції на справжню, зупиніть сервіс, перенесіть або видаліть
`/var/lib/lankadws/db/lankadws.db*` і файли в `/var/lib/lankadws/{files,quarantine,tmp}`, приберіть
`DEMO_SEED_PASSWORD` з `.env`, виконайте `npm run prisma:deploy` і `admin:create`.

## 6. Сервіси

```bash
sudo cp deploy/systemd/lankadws.service deploy/systemd/lankadws-backup.service deploy/systemd/lankadws-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now lankadws.service lankadws-backup.timer
systemctl status lankadws.service
journalctl -u lankadws.service -f
```

Якщо `node` встановлено не в `/usr/bin/node` (перевірте `command -v node`), виправте `ExecStart`
у `lankadws.service`.

## 7. HTTPS через Caddy

```bash
sudo cp deploy/caddy/Caddyfile /etc/caddy/Caddyfile
sudo sed -i 's/portal.example.com/ваш-домен/' /etc/caddy/Caddyfile
sudo usermod -aG lankadws caddy          # Caddy має читати /opt/lankadws/apps/web/dist
sudo mkdir -p /var/log/caddy
sudo systemctl reload caddy
```

## 8. Перевірка

```bash
curl -fsS http://127.0.0.1:3000/api/v1/health/live
curl -fsS http://127.0.0.1:3000/api/v1/health/ready
curl -fsSI https://ваш-домен/
```

Потім у браузері: вхід, стрічка, задачі, чат (повідомлення приходять без перезавантаження),
завантаження файла. Перший backup: `sudo systemctl start lankadws-backup.service`, потім
`sudo -u lankadws npm run restore:verify`.

## 9. Оновлення до нової версії

```bash
cd /opt/lankadws
sudo systemctl start lankadws-backup.service          # свіжий backup перед оновленням
sudo -u lankadws git fetch --tags
sudo -u lankadws git checkout v1.x.y
sudo -u lankadws npm ci
sudo -u lankadws npm run build
sudo systemctl stop lankadws.service
sudo -u lankadws npm run prisma:deploy
sudo systemctl start lankadws.service
curl -fsS http://127.0.0.1:3000/api/v1/health/ready
```

Відкат: `git checkout` попереднього тегу, `npm ci && npm run build`, перезапуск. Якщо нова версія
вже застосувала міграції, відновіть базу з backup, зробленого перед оновленням
(див. [operations-runbook.md](../docs/operations-runbook.md)).

## Важливо

- Працює **рівно один** процес над SQLite: не запускайте другий екземпляр і не кладіть базу на мережевий диск.
- `.env`, recovery secret і `BACKUP_ENCRYPTION_KEY` зберігайте окремо від сервера: без ключа backup не розшифрувати.
- Копіюйте `/var/backups/lankadws` на інший хост або сховище.
- Повний регламент (інциденти, ротація секретів, відновлення) — [docs/operations-runbook.md](../docs/operations-runbook.md).
