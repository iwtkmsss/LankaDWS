# Розгортання LankaDWS

Один процес Node (API і фонові задачі) на `127.0.0.1:3000`, SQLite і файли на локальному диску,
nginx віддає фронтенд з `apps/web/dist` і проксює `/api/`. Команди нижче — для Ubuntu/Debian під
`root`, код у `~/LankaDWS`, дані в `~/lankadws-data`. Якщо працюєте під іншим користувачем,
замініть `/root` на свою домашню папку тут, у `.env` і в `deploy/systemd/*.service`.

## 1. Node 24

```bash
curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
apt install -y nodejs git build-essential python3
```

npm до 12 не оновлюйте; `npm audit fix --force` не запускайте — зламає залежності.

## 2. Код і `.env`

```bash
cd ~
git clone https://github.com/iwtkmsss/LankaDWS.git
cd ~/LankaDWS
npm ci
mkdir -p ~/lankadws-data/{db,files,quarantine,tmp,backups}
cp deploy/production.env.example .env
nano .env
```

У `.env` змініть:

- `FRONTEND_ORIGIN` і `FRONTEND_BASE_URL` — ваш домен, `https://`, без `/` в кінці;
- шляхи `/root/lankadws-data/...`, якщо домашня папка інша;
- `DEMO_SEED_PASSWORD` — пароль демо-акаунтів;
- `MALWARE_SCANNER=unavailable`, поки не встановлений ClamAV (крок 7).

## 3. Збірка і секрети

```bash
npm run build
npm run lankadws -- recovery:hash
```

Якщо на сервері менше 2 ГБ RAM, збірка може впасти з `heap out of memory`: додайте swap і
збирайте з `NODE_OPTIONS=--max-old-space-size=3072 npm run build`.

`recovery:hash` просить ввести `GENERATE` і записує секрети в `.env`. Він один раз показує
recovery secret — збережіть його в менеджер паролів, нікому не показуйте. Це аварійний ключ, щоб
повернути доступ, якщо не лишиться жодного адміністратора (`npm run lankadws -- admin:recover`).

## 4. Дані

**Демо** (`VITE_DEMO_MODE=true`, так стоїть у шаблоні):

```bash
npm run demo:seed
```

Акаунти `maria`, `andrii`, `olena`, `dmytro` (адмін), `marko` і пароль видно на екрані входу.

**Справжня робота:** у `.env` поставте `VITE_DEMO_MODE=false`, приберіть `DEMO_SEED_PASSWORD`, і:

```bash
npm run db:wipe          # зносить базу й файли (backup не чіпає), створює порожню базу
npm run build            # збірка без демо-паролів
npm run admin:create     # перший адміністратор, далі він сам створює користувачів
```

Якщо до цього вже працювало демо, спершу зупиніть сервіс (`systemctl stop lankadws`), а секрети
краще замінити: `npm run lankadws -- recovery:hash` (попросить `ROTATE`).

## 5. Сервіс

```bash
cp deploy/systemd/lankadws.service deploy/systemd/lankadws-backup.service deploy/systemd/lankadws-backup.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now lankadws lankadws-backup.timer
curl http://127.0.0.1:3000/api/v1/health/ready
```

Першим кількам секундам після старту `curl` може не відповісти — повторіть. Лог:
`journalctl -u lankadws -n 50 --no-pager`.

## 6. nginx

```bash
cat > /etc/nginx/sites-available/lankadws <<'EOF'
server {
    listen 80;
    listen [::]:80;
    server_name lanka.example.com;

    client_max_body_size 110m;

    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffering off;      # чат отримує повідомлення через довге з'єднання
        proxy_read_timeout 1h;
    }

    location / {
        root /root/LankaDWS/apps/web/dist;
        try_files $uri /index.html;
    }
}
EOF
sed -i 's/lanka.example.com/ваш-домен/' /etc/nginx/sites-available/lankadws
ln -sf /etc/nginx/sites-available/lankadws /etc/nginx/sites-enabled/lankadws
chmod o+x /root /root/LankaDWS /root/LankaDWS/apps /root/LankaDWS/apps/web
chmod -R o+rX /root/LankaDWS/apps/web/dist
nginx -t && systemctl reload nginx
```

Сайт має відкриватися по `https://` (наприклад, через Cloudflare або власний сертифікат): cookie
входу передається лише по HTTPS. Після кожного `npm run build` повторіть останній `chmod -R`.

## 7. ClamAV (перевірка завантажених файлів)

Потрібно ≈1–1,3 ГБ RAM.

```bash
apt install -y clamav clamav-daemon
systemctl stop clamav-freshclam
freshclam
cat >> /etc/clamav/clamd.conf <<'EOF'
TCPSocket 3310
TCPAddr 127.0.0.1
StreamMaxLength 100M
MaxFileSize 100M
MaxScanSize 200M
ConcurrentDatabaseReload no
EOF
systemctl enable --now clamav-freshclam
systemctl restart clamav-daemon
```

Порт задається лише в `clamd.conf`; не додавайте `ListenStream` для 3310 у
`clamav-daemon.socket`, інакше сокет не стартує з `Address already in use`. Через 1–2 хвилини:

```bash
ss -ltnp | grep 3310
sed -i 's/^MALWARE_SCANNER=.*/MALWARE_SCANNER=clamav/' ~/LankaDWS/.env
systemctl restart lankadws
cd ~/LankaDWS && npx tsx apps/api/scripts/check-file-scanner.ts
```

Остання команда має вивести `ClamAV: clean sample accepted; EICAR blocked.`

## Оновлення

```bash
cd ~/LankaDWS && git pull && npm ci && npm run build
systemctl stop lankadws && npm run prisma:deploy && systemctl start lankadws
chmod -R o+rX ~/LankaDWS/apps/web/dist
```

Backup, відновлення та інциденти — [docs/operations-runbook.md](../docs/operations-runbook.md).
