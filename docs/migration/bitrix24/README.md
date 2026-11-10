# Bitrix24 → LankaDWS: історичний і міграційний контекст

Ця тека — архів планів переносу з Bitrix24. Вона **не описує поточну архітектуру** LankaDWS; чинні
правила продукту — у [docs/decisions.md](../../decisions.md), архітектура — у
[docs/architecture.md](../../architecture.md).

Рішення 2026-11-10: дані з Bitrix24 переносяться **одноразовим скриптом на сервері**. Вбудований
import control plane (`modules/import-control`, команди `import:*`, ключі `BITRIX_*` /
`IMPORT_SIGNING_*`) прибрано з застосунку. Описані тут manifest, sealing, DDB-гейти та `APPLY`
стосуються лише того плану й можуть слугувати довідкою для скрипта.

- [Продуктовий план переносу функціональності](bitrix24-functionality-migration-plan.md)
- [План переносу БД і файлів](bitrix24-database-migration-plan.md)
- [Приклад seal request](examples/bitrix-snapshot-seal-request.example.json)
- `assets/` — знімки й макети, на які посилаються плани.

Не читайте ці матеріали для звичайних задач продукту чи UI.
