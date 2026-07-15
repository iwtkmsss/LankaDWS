# Static assets and visual evidence

## Runtime assets

- `apps/web/public/assets/auth/editorial-workspace.png` — login editorial panel.
- `apps/web/public/assets/heroes/employee-overview.webp` — employee dashboard cutout.
- `apps/web/public/assets/heroes/manager-overview.webp` — manager dashboard cutout.
- `apps/web/public/assets/heroes/hr-overview.webp` — HR dashboard cutout.
- `apps/web/public/assets/heroes/admin-overview.webp` і `admin-system.webp` — administrator visuals.
- `apps/web/public/assets/lifecycle/onboarding-workspace.webp` і `offboarding-workspace.webp` — lifecycle states.
- `apps/web/public/assets/errors/error-orbit.png` — 403/404/500/offline/conflict/maintenance pages.
- `apps/web/public/assets/avatars/avatar-*.webp` — local demo avatar cutouts.
- `apps/web/public/licenses/ONEST-OFL-1.1.txt` — bundled Onest font license; runtime font files надходять із local npm build, без remote dependency.

Bitmap assets створені локально для цього workspace, role cutouts очищені до alpha background і підключені як static imports/URLs. Production не залежить від remote image/font CDN.

## Browser screenshots

Playwright створює visual evidence у `apps/web/artifacts/screenshots/` для desktop/mobile overview та admin routes. PNG screenshots навмисно git-ignored як generated test artifacts; команда відтворення: `npm run test:e2e --workspace @bert-crm/web`. HTML report: `apps/web/artifacts/playwright-report/`.
