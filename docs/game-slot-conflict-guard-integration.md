# Защита игр от пересечения слотов

## Где находится авторитетная запись

В текущем checkout `ph-ab` модуль `GamesService` читает `lk_games` и меняет только
административные поля и публикации. Создание игры и подтверждение оплаты проходят в
Node-RED LK Games другого checkout через:

- `POST /lk/games`;
- `POST /lk/games/drafts`;
- `POST /lk/games/payment/confirm`;
- их alias-endpoints.

Поэтому добавление проверки только в `ph-ab` не защитит production-запись. Готовый
код двух Node-RED Function nodes экспортируется из
`scripts/nodered-game-slot-conflict-guard.mjs`:

- `PREPARE_SLOT_CONFLICT_FUNCTION_SOURCE` — нормализует слот и формирует MongoDB
  `find` для `lk_games`;
- `RESOLVE_SLOT_CONFLICT_FUNCTION_SOURCE` — повторно проверяет найденные документы,
  возвращает `409 GAME_SLOT_CONFLICT` либо пропускает исходную команду.

## Обязательная точка до оплаты

Добавить в LK Games endpoint `POST /lk/games/slot-conflicts/check`:

```text
HTTP in
  -> Prepare slot conflict lookup (3 outputs)
  -> MongoDB4 find lk_games / toArray
  -> Resolve slot conflict lookup (3 outputs)
  -> HTTP response
```

Frontend обязан вызывать этот endpoint непосредственно перед
`apiPayMasterService`. Только ответ `200 { available: true }` разрешает запрос к
Viva на создание транзакции. Ответ `409` показывает пользователю, что слот уже
занят, и обновляет расписание.

Проверка использует один и тот же `studioId + roomId + date` и условие:

```text
existing.startTs < requested.endTs && existing.endTs > requested.startTs
```

Отменённые/архивные записи исключаются. Записи с тем же `gameId`, `paymentRef` или
`vivaExerciseId` считаются повтором одной операции и не являются конфликтом.

## Авторитетная проверка перед записью

Те же две Function nodes нужно поставить перед существующим `Prepare game upsert`
для всех шести create/draft/confirm HTTP nodes. Для обычной команды без конфликта
resolver восстанавливает исходный `msg.payload` и передаёт его в текущий upsert.

Если платежа ещё нет, конфликт отвечает `409`. Если запрос уже является
`payment/confirm` или payload содержит `payment.paid: true`, запись не теряется и не
отменяется: resolver меняет её статус на `CONFLICT_REVIEW` и добавляет
`metadata.slotConflictReview` с конфликтующим ID, интервалом и временем обнаружения.
Далее существующий upsert сохраняет запись для ручного переноса или возврата.

## Ограничение и следующий этап

MongoDB `find` перед `updateOne` закрывает текущую логическую ошибку, но не является
атомарным: два параллельных запроса всё ещё могут одновременно увидеть свободный
слот. Перед включением строгой production-гарантии нужна коллекция резерваций с
уникальными ключами временных сегментов либо транзакционный writer. Резервация
создаётся до Viva payment, имеет TTL для неоплаченного checkout и освобождается при
отмене.

Live flow необходимо сначала забрать с `lk-primary-147`, сделать backup, применить
узкий patch к актуальному `Prepare game upsert`, пересобрать modular import и
прогнать `nodered:modular:validate`. Этот артефакт сам production не меняет.
