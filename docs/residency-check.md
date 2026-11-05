# Мобильная проверка резидента в ЦУП (/api/ui/admin/residency/check)

Ветка: `agent/residency-check-20261105`, source-only. Риск R3 (staff auth, PII,
станционные scope, идемпотентные команды). Ветка не выполняет deploy, миграции,
live-мутации или изменение реальных прав.

## Задача

Сотрудник ЦУП на телефоне сканирует QR обычной камерой. QR ведёт на мобильный
экран проверки резидента. До показа данных сотрудник проходит штатную
авторизацию ЦУП. Экран показывает крупное фото, имя, станцию, состояние и срок
резидентства, доступные услуги и причины ограничений. Сотрудник сверяет
человека с фото, выбирает выдаваемые позиции и подтверждает выдачу. Успех
показывается только после ответа сервера. Повтор после сетевого таймаута
использует тот же `Idempotency-Key`, автоматическая новая выдача не создаётся.
Есть минимальный журнал и действие возврата ракетки.

Границы: без аналитики, экспорта, склада/остатков, CRUD клиентов, отдельной CRM.
Не редактируются `client-sdk/phab-admin-panel.js`, навигация и общие стили
панели. Модуль изолирован: собственный контроллер страницы, собственные
client-sdk файлы, собственный read-only profile endpoint и собственные тесты.

## Контракты и владение

- **C (формат QR-входа)**: клиент резидента кодирует в QR URL
  `https://padlhub.su/admin/residency/check?pass=<passToken>`; сам токен
  выдаёт D на 30–120 секунд (HMAC-хеш хранится только в D). Страница принимает
  `pass` и alias `token`. Дополнительно постоянная QR-ссылка ЦУП
  (`/q/<code>`, модуль QR-ссылок) может вести на этот экран как station
  deep-link, но не заменяет одноразовый токен и не подтверждает резидентство.
- **D (resident-services)**: владелец паспорта резидента, доступности услуг,
  выдачи, возврата и журнала. E не дублирует его данные, коллекции, индексы,
  идемпотентность или права. Браузер вызывает готовые staff-маршруты D напрямую
  с cookie-аутентификацией ЦУП; права и станционные ограничения проверяет D.
- **E (эта ветка)**: мобильная страница и один read-only endpoint отображаемого
  профиля (имя/фото). E не пишет резидентство, не выдаёт и не возвращает услуги
  сам — только вызывает D и показывает результат после ответа сервера.
- **Источник имени/фото**: существующие данные подписки
  (`SubscriptionsRepository.runtimeInstanceById` → `providerClientId`) и
  существующий read-only профиль Viva
  (`VivaAdminService.getClientProfile`). Это не новая CRM: данные не
  сохраняются, provider id не выходит в браузер, при недоступности источника
  показываются инициалы и «Резидент».

## Маршрут и авторизация

- Страница: `GET /api/ui/admin/residency/check?pass=<rsp1_...>&stationId=<id>`
  (текущий Nest-роутер с глобальным префиксом `api`).
- `/admin/residency/check` — необязательный nginx alias, см.
  `deploy/server-147/nginx-residency-check-location.conf`; не применяется
  автоматически (routing/DNS — отдельное согласованное действие).
- Без валидной staff-сессии — 302 на
  `/api/ui/admin/login?next=<encoded ...>`. ПДн не рендерятся server-side.
- `pass` — короткоживущий одноразовый токен паспорта D (`rsp1_...`, TTL
  30–120 c, HMAC-хеш хранится только в D). `token` принимается как alias.
  Токен не является staff-аутентификацией.
- Заголовки страницы: `Cache-Control: private, no-store`,
  `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex, nofollow`, CSP без
  внешних источников (img: self/https/data).
- `RESIDENCY_CHECK_ENABLED=false` — страница 503, API профиля 503
  `RESIDENCY_CHECK_DISABLED`.

## Station и права

D требует явный `stationId` и сам проверяет станционный scope сотрудника.
E определяет станцию так:

1. `stationId` из QR/URL, если он входит в scope;
2. единственная станция из scope
   (`permissionStationScopes['resident-services:issue']`, иначе `stationIds`);
3. `RESIDENCY_CHECK_DEFAULT_STATION_ID`;
4. иначе сотрудник выбирает станцию в UI; для глобального доступа без списка —
   явный выбор/ввод станции.

Названия станций опционально задаются `RESIDENCY_CHECK_STATION_LABELS` (JSON
`{"station-id":"Название"}`); без них показывается stationId. Домашняя станция
резидента (`homeStationId`) показывается отдельно.

Права D (не дублируются в E): `resident-services:issue` (preview и выдача),
`resident-services:return` (возврат), `resident-services:read` (журнал).
UI скрывает/отключает действия без соответствующего права и показывает
пояснение. Профильный endpoint E требует `resident-services:issue`; сама
страница — только staff-роль. Новых permission-ключей и ролей эта ветка не
добавляет.

## API E (единственный новый endpoint)

```
GET /api/v1/admin/residency/profile?subscriptionInstanceId=<id>
```

`@Roles(...STAFF_ROLES)`, `@Permissions('resident-services:issue')`,
`Cache-Control: private, no-store`, 400 `RESIDENCY_REQUEST_INVALID` при
невалидном id, 503 `RESIDENCY_CHECK_DISABLED` при выключенном флаге. Ответ:

```json
{ "subscriptionInstanceId": "...", "fullName": "Анна Резидентова", "photoUrl": "https://cdn.example/a.jpg" }
```

`fullName` — «Резидент» при недоступном профиле; `photoUrl` — только
`https://` или site-relative `/...`, иначе null. Ответ не содержит provider id,
телефона, подписки или иных скрытых полей. Ошибки/логи не содержат ПДн.

## Вызовы D из UI

| Действие | Маршрут D | Заголовки |
| --- | --- | --- |
| Проверка пропуска | `POST /api/v1/admin/resident-services/passes/preview` | cookie |
| Выдача | `POST /api/v1/admin/resident-services/issuances` | cookie, `Idempotency-Key` 16–128, `X-Correlation-ID` 8–128 |
| Возврат ракетки | `POST /api/v1/admin/resident-services/issuances/:issuanceId/returns` | cookie, `Idempotency-Key` |
| Журнал | `GET /api/v1/admin/resident-services/journal?stationId=&limit=` | cookie |

Тела/ответы — контракт D (см. `docs/resident-services.md` в ветке D и
`src/residency-check/residency-check.types.ts` для формы). D подтверждает
успех durable-записью и возвращает тот же issuanceId при повторе с тем же
ключом; E/UI не создаёт локального успеха и не повторяет POST автоматически.

## Экран

Файлы: `src/residency-check/residency-check-page.controller.ts`,
`client-sdk/phab-residency-check.js`, `client-sdk/phab-residency-check.css`.
Требования: mobile-first 390×844, крупное фото (fallback — инициалы), имя,
станция и домашняя станция, статус/срок, тип подписки, услуги с остатками и
причинами ограничений. Выбор позиций, подтверждение с тем же ключом при
повторе после timeout, состояние «результат неизвестен» без авто-повтора,
успех только после ответа D, возврат ракетки, минимальный журнал. Кнопки
≥44px, `aria-live`, фокус на результате, `no-store`, никаких изменений
`phab-admin-panel.js`, навигации и общих стилей.

Локальный preview/QA без D: `RESIDENCY_CHECK_DEMO_MODE=true` и
`NODE_ENV!==production`. UI показывает детерминированные демо-данные и бейдж
«Демо-данные», не обращаясь к сети. В production флаг игнорируется.

## Ошибки

D: `RESIDENT_PASS_NOT_FOUND`, `RESIDENT_PASS_INVALID`,
`RESIDENT_PASS_EXPIRED`, `RESIDENT_PASS_ALREADY_USED`, `RESIDENT_NOT_ACTIVE`,
`RESIDENT_TERM_EXPIRED`, `RESIDENT_STATION_REQUIRED`,
`RESIDENT_STATION_FORBIDDEN`, `RESIDENT_SERVICE_NOT_CONFIGURED`,
`RESIDENT_SERVICE_LIMIT_EXCEEDED`,
`RESIDENT_SERVICES_IDEMPOTENCY_CONFLICT`,
`RESIDENT_SERVICES_IDEMPOTENCY_KEY_INVALID`, `RESIDENT_ISSUANCE_NOT_FOUND`,
`RESIDENT_SERVICES_PERSISTENCE_UNAVAILABLE`, `RESIDENT_SERVICES_DISABLED`.
E: `RESIDENCY_CHECK_DISABLED` (503), `RESIDENCY_REQUEST_INVALID` (400).

## Конфигурация

```text
RESIDENCY_CHECK_ENABLED=false
RESIDENCY_CHECK_DEMO_MODE=false
RESIDENCY_CHECK_DEFAULT_STATION_ID=
RESIDENCY_CHECK_STATION_LABELS=
```

D использует собственные флаги/секреты (`RESIDENT_SERVICES_ENABLED`,
`RESIDENT_SERVICES_INTEGRATION_TOKEN`, `RESIDENT_SERVICES_TOKEN_PEPPER`,
`RESIDENT_SERVICES_TENANT_ID`, ...) — E их не переопределяет и не раскрывает.
Порядок интеграции: C (QR) → D (resident-services) → E (экран), затем включение
флагов и выдача прав ролям отдельным согласованным действием.

## Проверки (LOCAL)

```bash
npm run test:residency-check
npx tsc -p tsconfig.build.json --noEmit --incremental false
npm run build
```

Preview: `ADMIN_AUTH_ENABLED=false RESIDENCY_CHECK_ENABLED=true
RESIDENCY_CHECK_DEMO_MODE=true NODE_ENV=development`; проверить loading/error/
success/unknown-outcome/journal/return и viewport 390×844. CI/STAGING/PRODUCTION
evidence не заявляются; deployment и включение флагов не выполняются.

## Rollback

`RESIDENCY_CHECK_ENABLED=false` отключает страницу и профильный endpoint без
изменения данных D. Откат E не удаляет и не меняет коллекции/индексы D; выдачи
и возвраты остаются в журнале D. Удаление данных D — отдельное согласованное
действие владельца. Nginx alias не применяется без отдельного deploy-решения.
