# Фактический реестр Viva и текущего ЦУП

Дата baseline checkout: 20 июля 2026 года.
Кодовый baseline относится только к `/Users/zver/Desktop/ph-ab`. Дополнительно 20 июля выполнена read-only browser-проверка двух экранов авторизованного `cabinet.vivacrm.ru`; она не является полным production audit.

## Правило заполнения

Каждая строка должна иметь: `ID`, домен, объект/операцию, роль, окружение, evidence, статус, owner, решение и дату повторной проверки. Секреты, персональные данные и полные production payload в реестр не вставляются.

Решение по строке выбирается из: `MIGRATE`, `REPLACE`, `KEEP_EXTERNAL`, `RETIRE`, `UNDECIDED`.

## 1. Наблюдаемый baseline ЦУП

### Экраны и действия

| ID | Поверхность | Наблюдаемое поведение | Evidence | Статус | Решение |
|---|---|---|---|---|---|
| CUP-UI-001 | `/api/ui/admin/login` | Вход сотрудника в ЦУП | `src/ui/ui.controller.ts`, `src/auth/*` | `FACT_REPO` | `KEEP` |
| CUP-UI-002 | `/api/ui/admin` → Диалоги | Список диалогов, сообщения, ответы, закрытие, SLA/AI-подсказки | `client-sdk/phab-admin-panel.js`, `src/messenger/*`, `src/support/*` | `FACT_REPO` | `KEEP` |
| CUP-UI-003 | Игры | Поиск, карточка, чат, метаданные, исключение игрока, снятие публикации | `src/games/*` | `FACT_REPO` | `KEEP/EXPAND` |
| CUP-UI-004 | Уведомления | Административная поверхность уведомлений; фактический transport требует runtime-проверки | `client-sdk/phab-admin-panel.js`, `src/web-push/*` | `FACT_REPO` | `UNDECIDED` |
| CUP-UI-005 | Уровни | Поиск игрока, история, ручное изменение, повтор Viva projection | `src/player-ratings/*` | `FACT_REPO` | `KEEP` |
| CUP-UI-006 | Логи | UI журнала; полнота источников требует runtime-проверки | `client-sdk/phab-admin-panel.js` | `FACT_REPO` | `KEEP/EXPAND` |
| CUP-UI-007 | Турниры | Viva/LK/custom-источники, редактор, участники/waitlist, расписание, результаты, оплата | `src/tournaments/*` | `FACT_REPO` | `KEEP/EXPAND` |
| CUP-UI-008 | Сообщества | Настройки, участники, заявки, контент, чат, рейтинг | `src/communities/*` | `FACT_REPO` | `KEEP` |
| CUP-UI-009 | Лаборатория | Americano simulation/generation; production ownership не определён | `src/tournaments/americano-*` | `FACT_REPO` | `UNDECIDED` |
| CUP-UI-010 | Аналитика | Игровые и support-метрики; полнота финансовых отчётов не подтверждена | `src/games/games.controller.ts`, `src/support/support.controller.ts` | `FACT_REPO` | `EXPAND` |
| CUP-UI-011 | Настройки | Станции, коннекторы, правила доступа, quick replies, Viva settings | `src/messenger/messenger.controller.ts` | `FACT_REPO` | `KEEP/EXPAND` |
| CUP-UI-012 | Админы и управляющие | Сотрудники, роли, права, станции, аудит | `src/auth/*`, `docs/admin-users/rbac.md` | `FACT_REPO` | `KEEP` |
| CUP-UI-013 | Реклама | Настройка рекламных карточек/медиа | `src/advertising/*` | `FACT_REPO` | `KEEP` |

Наличие экрана в bundle не доказывает, что feature flag включён или endpoint исправен в production. Для каждой строки нужен browser/runtime probe.

### API и интеграции с Viva, найденные в checkout

| ID | Контур | Наблюдаемые вызовы | Назначение | Contract status |
|---|---|---|---|---|
| VIVA-API-001 | Keycloak/OIDC | token endpoint; в конфигурации присутствуют static bearer и password grant | Сервисная авторизация | `DECISION_REQUIRED` |
| VIVA-API-002 | Admin clients | `/api/v2/search/clients`, `/api/v1/clients/{id}` | Поиск клиента, кабинет, custom rating field | `FACT_REPO`, не `FACT_VIVA` |
| VIVA-API-003 | Admin exercises/bookings | Несколько вариантов `/exercises`, `/group-exercises`, `/bookings` | Участники, статусы и платежные данные занятия | `FACT_REPO`, контракт не фиксирован |
| VIVA-API-004 | Admin products/contracts | `/products`, `/products/subscriptions/{id}`, `/products/available/by-booking`, `/contracts/clients/{id}` | Подбор продукта/абонемента | `FACT_REPO`, контракт не фиксирован |
| VIVA-API-005 | Admin transactions | `/api/v1/transactions` | Создание платежной транзакции | `FACT_REPO`, контракт не фиксирован |
| VIVA-API-006 | End-user profile | `/end-user/api/v1/{widget}/profile` | Текущий клиент и auth/session context | `FACT_REPO`, контракт не фиксирован |
| VIVA-API-007 | End-user catalog/schedule | studios, trainers, exercises по widget/date | Турнирная витрина и расписание | `FACT_REPO`, контракт не фиксирован |
| VIVA-API-008 | End-user bookings | v1/v2 booking routes | Запись на турнир/занятие | `FACT_REPO`, контракт не фиксирован |
| VIVA-API-009 | End-user products/transactions | products, transactions, status | Оплата записи | `FACT_REPO`, контракт не фиксирован |
| VIVA-API-010 | Viva → Support | Node-RED inbound payload `{phone,email,content,notificationType}` | Служебные события в support | `FACT_REPO`, webhook contract не подтверждён |
| VIVA-API-011 | Rating projection | Изменение numeric custom field клиента | ЦУП → Viva projection рейтинга | `FACT_REPO`; ЦУП уже объявлен canonical owner |
| VIVA-API-012 | Tournament cancel sync | Периодический опрос Viva и автосмена статуса custom tournament | Временная сверка отмен | `FACT_REPO`; polling, не webhook |

Код адаптера пробует альтернативные URL и извлекает значения из нескольких возможных ключей. Это свидетельство отсутствия надёжно зафиксированного контракта, а не допустимый контракт этапа миграции.

### Данные, обнаруженные в текущем ЦУП

| ID | Набор/коллекция | Наблюдаемая роль | Текущий owner по коду | Проверить |
|---|---|---|---|---|
| DATA-001 | `admin_users`, `admin_roles`, `admin_audit_log` | Сотрудники, роли, аудит | ЦУП | Runtime RBAC, MFA/SSO, retention |
| DATA-002 | `player_rating_state`, `rating_events`, `rating_projection_outbox` | Canonical рейтинг, immutable events, projection | ЦУП (`CUP_CANONICAL`) | Полнота и reconciliation с Viva |
| DATA-003 | `player_ratings` | Совместимая проекция рейтинга | ЦУП projection | Consumers и срок вывода |
| DATA-004 | `lk_games`, `events`, `chat_messages` | Игры, telemetry, чат | LK/ЦУП граница требует решения | Writer, tenant и lifecycle |
| DATA-005 | `custom_tournaments` | Кастомные турниры, участники, waitlist, pricing snapshot | ЦУП | Identity/link на Viva и правила cutover |
| DATA-006 | `messenger_threads`, `messenger_messages` и settings | Диалоги и настройки | ЦУП | Retention, каналы, DSR/export |
| DATA-007 | support clients/dialogs/messages/outbox/metrics | Support 360 и доставка | ЦУП | Дедупликация с Viva client identity |
| DATA-008 | community collections | Сообщества, membership, feed | ЦУП | Политика удаления и связи с клиентом |
| DATA-009 | advertising settings/assets | Реклама | ЦУП | Object ownership и публикация в LK |
| DATA-010 | `integration_settings` (`viva_admin`) | Viva endpoint и секреты/учётные данные | ЦУП хранит config | Secret storage, rotation, запрет password grant |

## 2. Реестр Viva, который нужно снять с реального кабинета

Строки ниже — очередь walkthrough, а не подтверждённый список функций Viva.

| ID | Кандидатная область | Роли для walkthrough | Что записать | Статус | Owner |
|---|---|---|---|---|---|
| VIVA-UI-001 | Дэшбоард/расписание дня | Управляющий, администратор | Browser подтвердил location/date, фильтры, вид, техническое закрытие, 30-минутную сетку кортов, capacity и payment/status markers; lifecycle действий ещё снять | `FACT_RUNTIME_PARTIAL` | `TBD` |
| VIVA-UI-002 | Расписание день/неделя | Администратор, тренер | Фильтры, drag/drop, конфликты, блокировки, timezone | `TO_VERIFY` | `TBD` |
| VIVA-UI-003 | Карточка занятия/брони | Администратор | Создание, перенос, отмена, статус, участники, оплата | `TO_VERIFY` | `TBD` |
| VIVA-UI-004 | Waitlist | Администратор | Порядок, уведомление, автоперевод, отказ/таймаут | `TO_VERIFY` | `TBD` |
| VIVA-UI-005 | Check-in/attendance | Ресепшен, тренер | Проход, no-show, гостевой визит, долг | `TO_VERIFY` | `TBD` |
| VIVA-UI-006 | Клиент 360/семья | Администратор, Support | Поиск, merge, контакты, согласия, родственники, история | `TO_VERIFY` | `TBD` |
| VIVA-UI-007 | Каталог и ресурсы | Управляющий | Станции, корты, услуги, тренеры, типы занятий | `TO_VERIFY` | `TBD` |
| VIVA-UI-008 | Цены/скидки/промокоды | Управляющий, Finance | Правила, приоритеты, ручная скидка, approval | `TO_VERIFY` | `TBD` |
| VIVA-UI-009 | Транзакции/продажа и платеж | Ресепшен, Finance | Browser подтвердил summary cards, создание транзакции и колонки «Продажа / Сотрудник / Клиент / К оплате / Статус / Метод оплаты / Операции»; semantics кнопок и lifecycle ещё снять | `FACT_RUNTIME_PARTIAL` | `TBD` |
| VIVA-UI-010 | Возврат/коррекция | Управляющий, Finance | Полный/частичный возврат, отмена чека, причины, права | `TO_VERIFY` | `TBD` |
| VIVA-UI-011 | Абонементы/баланс | Ресепшен, Finance | Продажа, смена тарифа, заморозка, продление, списание | `TO_VERIFY` | `TBD` |
| VIVA-UI-012 | Отчёты и закрытие дня | Finance, управляющий | Выручка, оплаты, долги, посещения, выгрузки, сверка | `TO_VERIFY` | `TBD` |
| VIVA-UI-013 | Коммуникации | Support, Marketing | Шаблоны, массовые/транзакционные сообщения, opt-out | `TO_VERIFY` | `TBD` |
| VIVA-UI-014 | Сотрудники и права | Security, управляющий | Роли, MFA, станции, журнал входов/действий | `TO_VERIFY` | `TBD` |
| VIVA-UI-015 | Интеграции/API | Engineering, Viva | Credentials, webhooks, export, limits, failures | `TO_VERIFY` | `TBD` |

### Browser evidence от 20 июля 2026

- Окружение: `cabinet.vivacrm.ru`, авторизованная рабочая сессия; read-only навигация.
- Проверенная станция: Терехово. UUID станции, имена клиентов, сотрудников, суммы и строки операций намеренно не сохранены в репозитории.
- Подтверждённая навигация: Дэшбоард, Транзакции, Расписание групповых, Расписание персональных, Клиенты, Контрагенты; «Задачи и сделки» и HelpDesk ведут на отдельные Viva-сервисы.
- На расписании подтверждены: выбор location/date, фильтры, переключение вида, техническое закрытие времени, корты, 30-минутный шаг, заполненность занятия и визуальные признаки оплаты/статуса.
- На транзакциях подтверждены: агрегированные карточки, действие «Создать транзакцию», фильтруемый список и операции copy/history/QR/link/close. Назначение и права каждой иконки требуют operator walkthrough.
- Прямой переход на общий `/clients` в этой пробе не дал пригодного DOM evidence. Это не доказывает отсутствие раздела: ссылка видна в рабочей навигации, экран нужно повторно снять из штатного пользовательского пути.

## 3. Карточка одного walkthrough

Для каждого экрана/процесса сохранить:

- дата, окружение, версия/tenant Viva, станция;
- роль и сотрудник (в реестре — служебный ID, не личные данные);
- URL/название экрана и разрешения;
- входные данные и preconditions;
- пошаговые действия, скрытые ручные решения и обходы;
- какие записи созданы/изменены и где виден audit;
- какие сообщения, чеки, webhooks и интеграции сработали;
- ошибка, повтор, отмена и восстановление;
- отчёт, в котором операция появляется, и время задержки;
- ссылка на видео/скриншоты/HAR/export в защищённом evidence storage;
- решение `MIGRATE/REPLACE/KEEP_EXTERNAL/RETIRE` и владелец.

## 4. Минимальные runtime-пробы ЦУП

До подписания baseline выполнить отдельно в local/staging/production и не смешивать результаты:

1. Browser-login и проверка доступных вкладок для каждой роли.
2. Read-only запросы health, auth/me, games, tournaments, dialogs и ratings.
3. Проверка реального источника каждого ответа (`VIVA`, `CUSTOM`, `LK_PADELHUB_MONGO`, local collection).
4. Сверка одной сущности по стабильному ID между UI, API, БД и отчётом.
5. Проверка timestamps/timezone, audit actor и retry/idempotency.
6. Отдельная проверка платежного сценария только в sandbox.

## 5. Открытые блокеры baseline

| ID | Блокер | Влияние | Владелец | Срок |
|---|---|---|---|---|
| B-001 | Нет официальной спецификации Viva API/webhook/export | Нельзя утвердить интеграционный контракт | Viva owner | Конец недели 1 |
| B-002 | Не снят реальный список экранов и ролей Viva | Нельзя доказать полноту scope | Operations | Конец недели 2 |
| B-003 | Не подтверждены возвраты, чеки, settlement и отчёты | Нельзя проектировать Commerce cutover | Finance | Конец недели 3 |
| B-004 | Не подтверждён lifecycle абонементов и ledger | Нельзя назначить owner баланса | Product + Finance | Конец недели 3 |
| B-005 | Не снята IAM/access history Viva | Нельзя ввести break-glass | Security + Viva | Конец недели 1 |
| B-006 | Checkout baseline не подтверждён runtime | Нельзя выдавать код за production-факт | Engineering/SRE | Конец недели 2 |
