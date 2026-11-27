# Деплой і робочі команди

Повна інструкція з розгортання — [deploy/README.md](../deploy/README.md). Тут коротко: як оновити
сервер (зокрема з 2FA/OTP) і які команди потрібні в щоденній роботі.

## Деплой на сервер

Сервер розгорнутий за `deploy/README.md`: код у `/srv/lankadws/LankaDWS`, сервіс `lankadws`.

### 1. Копія бази перед оновленням (root)

```bash
sudo -iu lankadws sh -c 'cd ~/LankaDWS && npm run backup && npm run backup:check'
```

### 2. Перевірка `.env` (root)

```bash
sudo -iu lankadws grep -E '^(TOTP_ENCRYPTION_KEY|VITE_DEMO_MODE|SECOND_FACTOR_REQUIRED)=' /srv/lankadws/LankaDWS/.env
```

- `TOTP_ENCRYPTION_KEY` має бути справжнім ключем, а не `replace-with-…`. Якщо там заглушка —
  один раз `npm run lankadws -- recovery:hash`. **На робочому сервері ключ не ротуйте**: усі
  підключені OTP перестануть працювати.
- `VITE_DEMO_MODE=true` — демо, підходить будь-який 6-значний код; `false` — справжня перевірка.
- `SECOND_FACTOR_REQUIRED` на сервері не задавайте (`false` — лише для автотестів).

### 3. Оновлення і збірка (root)

```bash
sudo -iu lankadws sh -c 'cd ~/LankaDWS && git fetch && git checkout main && git pull && npm ci && npm run build'
systemctl stop lankadws
sudo -iu lankadws sh -c 'cd ~/LankaDWS && npm run prisma:deploy'
systemctl start lankadws
```

`VITE_DEMO_MODE` вшивається у фронтенд під час збірки: змінили в `.env` — знову `npm run build`.

### 4. Перевірка

```bash
curl http://127.0.0.1:3000/api/v1/health/ready
journalctl -u lankadws -n 50 --no-pager
```

У браузері:

- увійти адміном — з'явиться підключення 2FA;
- відсканувати QR, ввести код;
- вийти й увійти знову — попросить код;
- адмінка → Користувачі → людина: «Скинути коди», «Пустити без коду».

### 5. Якщо щось пішло не так

Адмін загубив телефон, а інших адмінів немає (заодно скидає його OTP):

```bash
sudo -iu lankadws sh -c 'cd ~/LankaDWS && npm run lankadws -- admin:recover'
```

Відкат на версію до OTP (`632ddd4`; міграцій БД у цьому оновленні немає):

```bash
sudo -iu lankadws sh -c 'cd ~/LankaDWS && git checkout 632ddd4 && npm ci && npm run build'
systemctl restart lankadws
```

Перед переходом сервера на `VITE_DEMO_MODE=false` переконайтеся, що в адміна є телефон із
застосунком-автентифікатором, інакше вхід лише через `admin:recover`.

## Щоденна робота (локально, Windows / PowerShell)

Запуск:

```powershell
npm run dev
```

Робота в `beta`:

```powershell
git checkout beta
git pull
```

Перевірки лише того, що змінили:

```powershell
npm run typecheck --workspace @lankadws/web
npm run lint --workspace @lankadws/web
npm run test --workspace @lankadws/api
npm run test:e2e --workspace @lankadws/web -- --project=desktop-chromium --grep "login"
```

Коміт:

```powershell
git add <файли>
git commit -m "feat(web): короткий опис"
```

Злиття `beta` в `main`:

```powershell
git fetch origin
git merge origin/main
git push origin beta
git push origin beta:main
```

`push beta:main` проходить лише тоді, коли `beta` вже містить усе з `main`, тому спершу завжди
`git merge origin/main`.

Скинути локальну демо-базу:

```powershell
npm run db:wipe
npm run demo:seed
```

Локально скинути пароль і 2FA адміна (у production не працює):

```powershell
npm run lankadws -- admin:dev-reset
```
