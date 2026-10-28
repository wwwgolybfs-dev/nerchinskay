# Supabase: Edge Function `telegram-api`

Функция задеплоена, версия **6** (28.10.2026). Добавлено действие `delete_workout`,
которого раньше не было, — из-за него приложение отвечало «Сервер не умеет удалять».

Код функции лежит в репозитории: [`functions/telegram-api/index.ts`](functions/telegram-api/index.ts)
(без секретов — ключи берутся из env: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
`TELEGRAM_BOT_TOKEN`). `verify_jwt = false`: авторизация внутри функции — подпись Telegram
`initData` или код синхронизации.

## Что умеет

| action | payload | Что делает |
|---|---|---|
| `get_profile` | — | профиль из `trek_profiles`, создаёт при первом входе |
| `upsert_profile` | вес, рост, возраст, пол, цель | сохраняет профиль |
| `generate_sync_code` | — | новый код вида `X7F9-A2B4` |
| `get_workouts` | `{ muscle_group? }` | последние 200 подходов |
| `add_workout` | упражнение, группа, вес, повторы, подходы | добавляет подход |
| **`delete_workout`** | `{ ids: [...] }` **или** `{ from, to }` | удаляет свои записи |
| `get_weight_log` | — | последние 100 замеров веса |
| `add_weight` | вес, % жира, мышцы | добавляет замер |

## `delete_workout` подробнее

```json
{ "action": "delete_workout", "payload": { "from": "2026-10-28T00:00:00+10:00",
                                           "to":   "2026-10-29T00:00:00+10:00",
                                           "day":  "2026-10-28" } }
{ "action": "delete_workout", "payload": { "ids": ["164c3abc-…"] } }
```

* `from`/`to` — границы дня в часовом поясе устройства (клиент считает их сам), удаление идёт
  по `logged_at` в диапазоне `[from, to)`.
* `day` — запасной вариант для старых клиентов из кэша: функция сама считает сутки по UTC+10.
* `ids` — точечное удаление конкретных подходов.
* Всегда добавляется `telegram_id = текущий пользователь`, поэтому чужие записи удалить нельзя
  (проверено: попытка удалить id другого профиля возвращает `deleted: 0`, строка остаётся).
* Ответ: `{ "ok": true, "deleted": 3 }` — число реально удалённых строк.

Важно: клиент показывает удаление только для **сегодняшних** записей, но функция технически
умеет удалять по любому диапазону — история задним числом не редактируется на уровне UI.

## Передеплой

Если правишь `functions/telegram-api/index.ts`:

```powershell
# 1) получить PAT: https://supabase.com/dashboard/account/tokens
$env:SUPABASE_ACCESS_TOKEN = 'sbp_…'

# 2) отправить код в проект (Management API)
$body = Get-Content supabase/functions/telegram-api/index.ts -Raw
$json = @{ name = 'telegram-api'; body = $body; verify_jwt = $false } | ConvertTo-Json -Compress
Invoke-RestMethod -Method Patch `
  -Uri 'https://api.supabase.com/v1/projects/xxauwkymufehmoprmhay/functions/telegram-api' `
  -Headers @{ Authorization = "Bearer $env:SUPABASE_ACCESS_TOKEN" } `
  -ContentType 'application/json; charset=utf-8' `
  -Body ([Text.Encoding]::UTF8.GetBytes($json))
```

Либо руками: Dashboard → Edge Functions → `telegram-api` → Code → вставить файл → **Deploy**.
`verify_jwt` должен остаться выключенным.

## Как проверялось

На временном профиле (`telegram_id = -777001`, код `TEST-9F3K`), данные удалены после теста:

1. 3 записи «сегодня» + 1 «вчера» → `delete_workout` с `from`/`to` → `deleted: 3`, вчерашняя осталась.
2. 2 записи → удаление по `ids` одной → `deleted: 1`, вторая на месте.
3. Попытка удалить запись другого пользователя → `deleted: 0`, строка не тронута.
