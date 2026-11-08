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
  `https://padlhub.su/admin/residency/check#pass=<passToken>` — токен идёт в
  **фрагменте** URL и не отправляется на сервер. Сам токен выдаёт D на 30–120
  секунд (HMAC-хеш хранится только в D). Формат с токеном в query
  (`?pass=`/`?token=`) этой веткой **не поддерживается**: такие ссылки
  попадали в access-log nginx и историю браузера (S-09). Интеграционный шаг C:
  собрать QR-назначение с фрагментом (см. «Интеграция»). Постоянная QR-ссылка
  ЦУП (`/q/<code>`, модуль QR-ссылок) может вести на экран как station
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

- Страница: `GET /api/ui/admin/residency/check?stationId=<id>` (текущий
  Nest-роутер с глобальным префиксом `api`). `stationId` необязателен и не
  является секретом.
- Токен пропуска: `#pass=<rsp1_...>` во фрагменте. Сервер его не получает:
  фрагмент не входит в HTTP-запрос, не попадает в access-log, HTML, заголовок
  `Referer`, историю сервера и в `next` login-редиректа. Серверная страница
  рендерит только shell и конфиг без токена.
- Клиентский скрипт читает фрагмент один раз, сразу выполняет
  `history.replaceState` (URL без `#`), хранит токен только в памяти и
  отправляет его телом запроса (preview D, профиль E, выдача D).
- `/admin/residency/check` — необязательный nginx alias (статический 302 без
  проброса аргументов), см.
  `deploy/server-147/nginx-residency-check-location.conf`; не применяется
  автоматически (routing/DNS — отдельное согласованное действие).
- Без валидной staff-сессии — 302 на
  `/api/ui/admin/login?next=<encoded path[?stationId=...]>`. В `next`
  попадают только путь и валидный `stationId`; legacy-`pass`/`token` из
  query отбрасываются. ПДн не рендерятся server-side.
- Токен не является staff-аутентификацией.
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
POST /api/v1/admin/residency/profile
{"passToken":"rsp1_...","stationId":"<station>","subscriptionInstanceId":"<optional cross-check>"}
```

`@Roles(...STAFF_ROLES)`, `@Permissions('resident-services:issue')`,
`Cache-Control: private, no-store`. Ответ:

```json
{ "subscriptionInstanceId": "...", "fullName": "Анна Резидентова", "photoUrl": "https://cdn.example/a.jpg" }
```

`fullName` — «Резидент» при недоступном профиле; `photoUrl` — только
`https://` или site-relative `/...`, иначе null. Ответ не содержит provider id,
телефона, подписки или иных скрытых полей. Ошибки/логи не содержат ПДн.

Объектная авторизация (S-08): endpoint **не является поиском по id**. Тело
обязано содержать `passToken` и `stationId`; сервер сам вызывает D preview
(`POST /api/v1/admin/resident-services/passes/preview`, тело
`{token, stationId}`) с **forwarded staff-сессией текущего запроса**
(cookie или `Authorization`), поэтому D заново проверяет право
`resident-services:issue`, станционный scope, состояние и срок пропуска и
резидентство. Профиль (имя/фото) читается только для
`resident.subscriptionInstanceId`, подтверждённого preview. Если тело передало
`subscriptionInstanceId` и он не совпадает с подтверждённым — 403 без ПДн;
неизвестный/просроченный/использованный пропуск — 403 без ПДн; отсутствие
staff-сессии — 401; недоступность D — 503. Запрошенный браузером id никогда не
используется как ключ чтения ПДн.

Стабильные ответы: 400 `RESIDENCY_REQUEST_INVALID` (невалидные тело/токен/
станция), 401 `RESIDENCY_AUTH_REQUIRED`, 403 `RESIDENCY_PASS_NOT_VERIFIED`
или `RESIDENCY_PROFILE_FORBIDDEN` (несовпадение instance id), 403
`RESIDENCY_ORIGIN_FORBIDDEN`, 503 `RESIDENCY_PASS_PREVIEW_UNAVAILABLE`,
`RESIDENCY_PASS_PREVIEW_INVALID`, `RESIDENCY_PASS_PREVIEW_URL_INVALID` и
`RESIDENCY_CHECK_DISABLED`.

Дополнительно для PII-ответа проверяется `Origin`: при наличии заголовка он
должен входить в доверенные (`RESIDENCY_CHECK_ADMIN_ORIGINS`, по умолчанию
`https://padlhub.su`; в не-production дополнительно `localhost:3000` и
`127.0.0.1:3000`). Глобальный CORS в приложении permissive, поэтому этот guard
не даёт сторонней странице воспроизвести staff-cookie на PII-маршрут. Запросы
без `Origin` (curl, server-side) не блокируются.

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

## Интеграция с D и допущения контракта (S-08)

В ветке E сервис D ещё не влит, поэтому серверный вызов preview реализован
через порт `ResidentPreviewPort`:

- `HttpResidentPreviewAdapter` (`src/residency-check/resident-preview.http.adapter.ts`)
  делает server-to-server `POST <base>/api/v1/admin/resident-services/passes/preview`
  с телом `{token, stationId}` и заголовками forwarded staff-сессии
  (`cookie`/`authorization` из исходного запроса). Base URL берётся из
  `RESIDENCY_CHECK_RESIDENT_SERVICES_URL`, по умолчанию
  `http://127.0.0.1:` + `PORT` (3000) — тот же инстанс API. Redirect для этого
  запроса запрещён (`redirect: 'error'`), таймаут 5 c, ретраев нет.
- В тестах порт заменён фейком; HTTP-адаптер покрыт отдельными тестами с
  подменённым `fetch`.

Задокументированные допущения (проверить при вливе D):

1. Preview принимает `{token, stationId}`, где `token` — `rsp1_<base64url>`
   (43 символа полезной нагрузки по контракту D); E принимает
   `^rsp1_[A-Za-z0-9_-]{32,64}$` как защитную границу, D остаётся арбитром.
2. Успешный ответ содержит `resident.confirmed === true` и
   `resident.subscriptionInstanceId`; E не читает ПДн из preview и требует
   только эти поля (плюс `passId`, `stationId`, `expiresAt`).
3. 4xx от D трактуется как отказ в проверке (403 без ПДн), 401 — как отсутствие
   staff-сессии, 5xx/network/timeout — как недоступность (503 без ПДн).
   Точный код D не пробрасывается клиенту, чтобы не менять контракт и не
   раскрывать детали.
4. Порядок: до включения профиля в проде D preview должен быть развёрнут и
   включён (`RESIDENT_SERVICES_ENABLED`), а `RESIDENCY_CHECK_RESIDENT_SERVICES_URL`
   должен указывать на тот же инстанс API (loopback по умолчанию).
5. Forwarded credentials не логируются, не сохраняются и не попадают в тело
   ответа; при отсутствии cookie/authorization профиль отвечает 401, не
   обращаясь в D.

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

## Восстановление после перезагрузки и вход сотрудника

**Перезагрузка после неизвестного результата.** Перед отправкой выдачи экран
кладёт в `sessionStorage` (`phab.residency.pendingIssue.v1`) только
`Idempotency-Key` попытки, станцию и срок пропуска — без QR-токена, Bearer,
имени, фото и позиций. Ключ сам по себе не повторяет выдачу: сервер сверяет
хеш запроса с токеном, а поиск по ключу доступен только тому же сотруднику.
После полной перезагрузки экран **до любой новой проверки** делает read-only
`GET /api/v1/admin/resident-services/issuance-attempts` с тем же ключом:

| Ответ | Экран |
| --- | --- |
| 200 | «Выдано» с исходной операцией (можно вернуть ракетку); отметка снимается |
| 404 и пропуск истёк > 90 с назад | «Прошлая выдача не сохранилась»; отметка снимается |
| 404, пропуск ещё мог записаться | «Результат неизвестен», «Проверить снова», журнал |
| 401/403/5xx/сеть | «Результат неизвестен», отметка сохраняется |

Новый QR в это время не проверяется и выдать по нему нельзя, пока сотрудник
не нажмёт «Проверено по журналу, продолжить». Окончательный 4xx на выдачу
(кроме 401/403/408/429) и подтверждённая выдача снимают отметку сразу.

**Сотрудник не авторизован.** 302 на логин переносит фрагмент `#pass=` в адрес
страницы входа. Страница входа сразу убирает его из адресной строки, держит в
памяти, не отправляет на сервер и после успешного входа возвращает сотрудника
на `/api/ui/admin/residency/check…#pass=…`. Фрагмент передаётся только этому
пути. Если QR за время входа истёк, проверка показывает «QR-код клиента истёк.
Попросите клиента показать новый QR» — истёкший пропуск не используется.

## Ошибки

D: `RESIDENT_PASS_NOT_FOUND`, `RESIDENT_PASS_INVALID`,
`RESIDENT_PASS_EXPIRED`, `RESIDENT_PASS_ALREADY_USED`, `RESIDENT_NOT_ACTIVE`,
`RESIDENT_TERM_EXPIRED`, `RESIDENT_STATION_REQUIRED`,
`RESIDENT_STATION_FORBIDDEN`, `RESIDENT_SERVICE_NOT_CONFIGURED`,
`RESIDENT_SERVICE_LIMIT_EXCEEDED`,
`RESIDENT_SERVICES_IDEMPOTENCY_CONFLICT`,
`RESIDENT_SERVICES_IDEMPOTENCY_KEY_INVALID`, `RESIDENT_ISSUANCE_NOT_FOUND`,
`RESIDENT_SERVICES_PERSISTENCE_UNAVAILABLE`, `RESIDENT_SERVICES_DISABLED`.
E: `RESIDENCY_CHECK_DISABLED` (503), `RESIDENCY_REQUEST_INVALID` (400),
`RESIDENCY_AUTH_REQUIRED` (401), `RESIDENCY_PASS_NOT_VERIFIED` (403),
`RESIDENCY_PROFILE_FORBIDDEN` (403), `RESIDENCY_ORIGIN_FORBIDDEN` (403),
`RESIDENCY_PASS_PREVIEW_UNAVAILABLE` / `RESIDENCY_PASS_PREVIEW_INVALID` /
`RESIDENCY_PASS_PREVIEW_URL_INVALID` (503).

## Конфигурация

```text
RESIDENCY_CHECK_ENABLED=false
RESIDENCY_CHECK_DEMO_MODE=false
RESIDENCY_CHECK_DEFAULT_STATION_ID=
RESIDENCY_CHECK_STATION_LABELS=
# base URL того же API, где живёт D preview (server-to-server, loopback)
RESIDENCY_CHECK_RESIDENT_SERVICES_URL=
# доверенные Origin для PII-POST профиля (CSV), по умолчанию https://padlhub.su
RESIDENCY_CHECK_ADMIN_ORIGINS=
```

D использует собственные флаги/секреты (`RESIDENT_SERVICES_ENABLED`,
`RESIDENT_SERVICES_INTEGRATION_TOKEN`, `RESIDENT_SERVICES_TOKEN_PEPPER`,
`RESIDENT_SERVICES_TENANT_ID`, ...) — E их не переопределяет и не раскрывает.
Порядок интеграции: C (QR, формат с `#pass=`) → D (resident-services) →
E (экран + pass-verified профиль), затем включение флагов и выдача прав ролям
отдельным согласованным действием.

## Проверки (LOCAL)

```bash
npm run test:residency-check
npx tsc -p tsconfig.build.json --noEmit --incremental false
npm run build
```

Preview: `ADMIN_AUTH_ENABLED=false RESIDENCY_CHECK_ENABLED=true
RESIDENCY_CHECK_DEMO_MODE=true NODE_ENV=development`; проверить loading/error/
success/unknown-outcome/journal/return и viewport 390×844. Без demo-режима для
негативных проверок: открыть `/api/ui/admin/residency/check#pass=rsp1_...` без
staff-сессии (редирект на login), с истёкшим/чужим пропуском (ошибка без ПДн),
с совпадающим/несовпадающим `subscriptionInstanceId`. Убедиться, что после
загрузки в адресной строке нет `#pass=` и что токен отсутствует в HTML/логах.
CI/STAGING/PRODUCTION evidence не заявляются; deployment и включение флагов не
выполняются.

## Rollback

`RESIDENCY_CHECK_ENABLED=false` отключает страницу и профильный endpoint без
изменения данных D. Откат E не удаляет и не меняет коллекции/индексы D; выдачи
и возвраты остаются в журнале D. Удаление данных D — отдельное согласованное
действие владельца. Nginx alias не применяется без отдельного deploy-решения.

Откат S-09: клиент, читающий `#pass=`, и сервер без токена в HTML/config
работают независимо; возврат к query-токену не требуется и не выполняется
(это вернуло бы утечку в логи). Переходный период для старых QR: ссылки с
`?pass=` открывают shell и показывают «нет идентификатора пропуска» —
пользователь открывает новый QR; альтернативы хранить/переиспользовать
query-токен нет.
