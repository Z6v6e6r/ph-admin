# Уровень только в ЦУП

Новый игрок не имеет уровня. Первое назначение — собственный онбординг ЛК либо
уполномоченный администратор/тренер ЦУП. Default D/1.0 и bootstrap уровня из Viva
не используются. Viva остаётся источником идентичности и контактов.

`POST /admin/player-ratings/assignments` требует `player-ratings:write`, точный clientId,
число 1–7 (до пяти знаков), непустую причину от 10 символов и idempotencyKey.
Клиент подтверждается по фактическому ID ответа Viva; level custom fields не читаются.
Транзакция вставляет immutable `RATING_INITIAL_ASSIGNED`, каноническое состояние,
compatibility projection и при включённой интеграции outbox для ЛК2. Конфликт имеющегося
состояния, client/phone-key history или aliases не перезаписывается первым назначением.
Idempotency key связан с актором, игроком и payload. Действующая CAS-корректировка
остаётся отдельной операцией.

Поиск кандидатов возвращает только необходимые идентификационные поля. Раздел уровней
позволяет выбрать клиента из этого поиска и назначить первый уровень с причиной.
Права read/write проверяются явными permission decorators. Новых прав по умолчанию и
роли тренера автоматически не создаётся; нужный аккаунт получает существующие
`player-ratings:read` и `player-ratings:write` через управляемую роль отдельной операцией.

Viva outbox больше не создаётся. `projection.status` возвращает `NOT_REQUIRED`.
Старый `/projection/retry` отвечает конфликтом `VIVA_LEVEL_PROJECTION_RETIRED`, не
перезапускает очередь. Исторические provider rows сохранены. Методы интеграции чтения
и записи Viva-level fail-closed. Совместимость enum статуса расширена, UI обновлён.

CUP→PadlHub/LK2 — отдельная действующая проекция. Первое назначение в immediate outbox
и background reconciliation отображается в существующий wire event type
`RATING_MANUALLY_CHANGED`; transport contract получателя не расширяется. Обычные
изменения продолжают использовать канонический lastEventId/CAS.

Парный LK PR должен перевести frontend, Node-RED, FPR helper и rating workers, включая
старые retry paths. Полный план: `docs/CUP_ONLY_PLAYER_LEVEL_CUTOVER.md` в репозитории LK.
Для живого переключения нужны backup/restore rehearsal, сверка всех существующих
уровней и идентичностей, уникальные индексы и остановка старых level senders. Физическое
удаление Viva fields не выполняется кодом и требует отдельного разрешения.

Проверки: `npm run test:player-ratings`, `npm run test:auth-rbac`, `npm run build`.
Изменённые endpoints и DTO не являются доказательством live deployment. После первого
canonical-only изменения откат к старому Viva UI без reconciliation небезопасен.
