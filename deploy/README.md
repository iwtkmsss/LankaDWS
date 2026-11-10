# Розгортання LankaDWS

Один процес Node (API і фонові задачі) на `127.0.0.1:3000`, SQLite і файли на локальному диску,
nginx віддає фронтенд з `apps/web/dist` і проксює `/api/`. Команди — для Ubuntu/Debian.

Застосунок працює від окремого непривілейованого користувача `lankadws`, а не `root`: код у
`/srv/lankadws/LankaDWS`, дані в `/srv/lankadws/data`. Біля кожного кроку вказано, від кого його
виконувати: **root** — системні кроки, **lankadws** — усе в каталозі застосунку (`sudo -iu lankadws`;
тоді `~` — це `/srv/lankadws`). Ці шляхи прописані в `deploy/systemd/*.service` і
`deploy/production.env.example`; міняйте їх лише разом.

## 1. Node 24 і користувач (root)

```bash
curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
apt install -y nodejs git build-essential python3 rsync
useradd --system --create-home --home-dir /srv/lankadws --shell /bin/bash lankadws
chmod 755 /srv/lankadws
install -d -m 700 -o lankadws -g lankadws /srv/lankadws/data
```

npm до 12 не оновлюйте; `npm audit fix --force` не запускайте — зламає залежності.

## 2. Код і `.env` (lankadws)

```bash
sudo -iu lankadws
git clone https://github.com/iwtkmsss/LankaDWS.git
cd ~/LankaDWS
npm ci
mkdir -p ~/data/{db,files,quarantine,tmp,backups}
cp deploy/production.env.example .env
chmod 600 .env
nano .env
```

У `.env` змініть:

- `FRONTEND_ORIGIN` і `FRONTEND_BASE_URL` — ваш домен, `https://`, без `/` в кінці;
- `MALWARE_SCANNER=unavailable`, поки не встановлений ClamAV (крок 7).

Шаблон налаштований на справжню роботу (`VITE_DEMO_MODE=false`). Демо — у кроці 4.

## 3. Збірка і секрети (lankadws)

```bash
npm run build
npm run lankadws -- recovery:hash
```

Якщо на сервері менше 2 ГБ RAM, збірка може впасти з `heap out of memory`: додайте swap і
збирайте з `NODE_OPTIONS=--max-old-space-size=3072 npm run build`.

`recovery:hash` просить ввести `GENERATE` і записує секрети в `.env`. Він один раз показує
recovery secret — збережіть його в менеджер паролів, нікому не показуйте. Це аварійний ключ, щоб
повернути доступ, якщо не лишиться жодного адміністратора (`npm run lankadws -- admin:recover`).

## 4. Дані (lankadws)

**Справжня робота** (`VITE_DEMO_MODE=false`, так стоїть у шаблоні):

```bash
npm run prisma:deploy    # порожня база
npm run admin:create     # перший адміністратор, далі він сам створює користувачів
```

**Демо:** у `.env` поставте `VITE_DEMO_MODE=true` і власний `DEMO_SEED_PASSWORD`, потім:

```bash
npm run build            # збірка з демо-акаунтами на екрані входу
npm run demo:seed
```

Акаунти `maria`, `andrii`, `olena`, `dmytro` (адмін), `marko` і пароль видно на екрані входу.

**З демо на справжню роботу:** зупиніть сервіс (root: `systemctl stop lankadws`), у `.env` поставте
`VITE_DEMO_MODE=false`, приберіть `DEMO_SEED_PASSWORD` і виконайте:

```bash
npm run db:wipe                     # покаже, що видалить, і попросить ввести WIPE; backup не чіпає
npm run build                       # збірка без демо-паролів
npm run lankadws -- recovery:hash   # замінити секрети (попросить ROTATE)
npm run admin:create
```

`db:wipe` відмовиться працювати, поки API відповідає на своєму порту.

## 5. Сервіс (root)

```bash
cp /srv/lankadws/LankaDWS/deploy/systemd/lankadws*.service /srv/lankadws/LankaDWS/deploy/systemd/lankadws*.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now lankadws lankadws-backup.timer lankadws-backup-check.timer
curl http://127.0.0.1:3000/api/v1/health/ready
```

Першим кількам секундам після старту `curl` може не відповісти — повторіть. Лог:
`journalctl -u lankadws -n 50 --no-pager`.

Сервіс ізольований: писати він може лише в `/srv/lankadws/data`, решта системи для нього тільки
для читання. Тому всі шляхи з `.env` (база, файли, backup) мають лежати всередині `/srv/lankadws/data`.

## 6. nginx (root)

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
        root /srv/lankadws/LankaDWS/apps/web/dist;
        try_files $uri /index.html;
    }
}
EOF
sed -i 's/lanka.example.com/ваш-домен/' /etc/nginx/sites-available/lankadws
ln -sf /etc/nginx/sites-available/lankadws /etc/nginx/sites-enabled/lankadws
nginx -t && systemctl reload nginx
```

Сайт має відкриватися по `https://` (наприклад, через Cloudflare або власний сертифікат): cookie
входу передається лише по HTTPS.

## 7. ClamAV — перевірка завантажених файлів (root)

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
sed -i 's/^MALWARE_SCANNER=.*/MALWARE_SCANNER=clamav/' /srv/lankadws/LankaDWS/.env
systemctl restart lankadws
sudo -iu lankadws sh -c 'cd ~/LankaDWS && npx tsx apps/api/scripts/check-file-scanner.ts'
```

Остання команда має вивести `ClamAV: clean sample accepted; EICAR blocked.`

## 8. LibreOffice — перегляд Word, Excel і PowerPoint (root)

Сервер перетворює документи Office на PDF, щоб їх можна було переглянути, не завантажуючи. Готовий PDF
кешується в `FILE_TEMP_DIR/office-previews`, тож кожен файл конвертується лише раз. Без LibreOffice
документи просто завантажуються, як і раніше. LibreOffice запускається всередині ізольованого
сервісу, від користувача `lankadws`.

```bash
apt install -y --no-install-recommends libreoffice-writer-nogui libreoffice-calc-nogui libreoffice-impress-nogui fonts-dejavu fonts-liberation fonts-crosextra-carlito fonts-crosextra-caladea
which soffice
grep -q '^OFFICE_PREVIEW_SOFFICE=' /srv/lankadws/LankaDWS/.env || echo 'OFFICE_PREVIEW_SOFFICE=soffice' >> /srv/lankadws/LankaDWS/.env
systemctl restart lankadws
```

`which soffice` має вивести шлях (зазвичай `/usr/bin/soffice`). Шрифти Carlito й Caladea метрично
сумісні з Calibri й Cambria, тож документи зберігають розмітку. Щоб вимкнути перегляд, залиште
`OFFICE_PREVIEW_SOFFICE=` порожнім.

## 9. Backup поза сервером

`lankadws-backup.timer` щогодини робить зашифровану копію в `/srv/lankadws/data/backups` — на тому ж
диску, тож від втрати диска чи сервера вона не захищає. Потрібна копія деінде:

1. Заведіть сховище на іншому хості (SSH-сервер, NAS або об'єктне сховище через `rclone`).
2. Створіть для користувача `lankadws` окремий SSH-ключ (root: `sudo -iu lankadws ssh-keygen -t ed25519`)
   і додайте його на хост зберігання.
3. У `/etc/systemd/system/lankadws-backup.service` розкоментуйте рядок `ExecStartPost=/usr/bin/rsync …`,
   вкажіть свій хост і шлях, потім `systemctl daemon-reload`.

Копії вже зашифровані `BACKUP_ENCRYPTION_KEY`; сам ключ зберігайте окремо від копій (менеджер паролів).

`lankadws-backup-check.timer` щогодини перевіряє, що найновішій копії не більше `BACKUP_MAX_AGE_HOURS`
годин (2 за замовчуванням). Якщо копія старша або її немає, сервіс `lankadws-backup-check` падає: це
видно в `systemctl --failed` і `journalctl -u lankadws-backup-check`. Під'єднайте `OnFailure=` до свого
сповіщення, якщо воно є. Ручна перевірка (lankadws): `npm run backup:check`.

## Оновлення (root)

```bash
sudo -iu lankadws sh -c 'cd ~/LankaDWS && git pull && npm ci && npm run build'
systemctl stop lankadws
sudo -iu lankadws sh -c 'cd ~/LankaDWS && npm run prisma:deploy'
systemctl start lankadws
```

## Перенесення встановлення з `root`

Якщо сервер уже працює за старою інструкцією (код у `/root/LankaDWS`, дані в `/root/lankadws-data`),
спершу зробіть backup (`cd /root/LankaDWS && npm run backup`), потім від root:

```bash
systemctl stop lankadws lankadws-backup.timer
useradd --system --create-home --home-dir /srv/lankadws --shell /bin/bash lankadws
chmod 755 /srv/lankadws
mv /root/LankaDWS /srv/lankadws/LankaDWS
mv /root/lankadws-data /srv/lankadws/data
chown -R lankadws:lankadws /srv/lankadws
chmod 700 /srv/lankadws/data
chmod 600 /srv/lankadws/LankaDWS/.env
sed -i 's#/root/lankadws-data#/srv/lankadws/data#g' /srv/lankadws/LankaDWS/.env
sed -i 's#/root/LankaDWS#/srv/lankadws/LankaDWS#' /etc/nginx/sites-available/lankadws
cp /srv/lankadws/LankaDWS/deploy/systemd/lankadws*.service /srv/lankadws/LankaDWS/deploy/systemd/lankadws*.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now lankadws lankadws-backup.timer lankadws-backup-check.timer
nginx -t && systemctl reload nginx
curl http://127.0.0.1:3000/api/v1/health/ready
chmod o-x /root
```

Останній рядок прибирає доступ до `/root`, який стара інструкція відкривала для nginx.

Backup, відновлення та інциденти — [docs/operations-runbook.md](../docs/operations-runbook.md).
