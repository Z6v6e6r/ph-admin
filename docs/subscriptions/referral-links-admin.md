# Реферальные ссылки в ЦУП

## Что реализовано

В ЦУП добавлена отдельная страница «Реферальные ссылки». Оператор указывает:

- название акции;
- кому выдана ссылка;
- целевую HTTPS-страницу;
- начало и окончание действия;
- необязательный внешний номер/примечание;
- необязательный код `TR-001..TR-050` для присоединения исторической таблицы тренерских QR.

Публичный переход проходит через `GET /api/referral-links/r/:publicToken`. ЦУП фиксирует `OPEN`, создаёт `visitId` и перенаправляет на разрешённую страницу с параметрами `ref` и `ref_visit`. Произвольный redirect запрещён: допустимые origin задаются `REFERRAL_LINKS_ALLOWED_ORIGINS`.

## Статистика и данные

Экран показывает по дням (часовой пояс `Europe/Moscow`):

- все открытия;
- уникальные визиты;
- переходы к оплате;
- оплаченные покупки;
- уникальных покупателей;
- начатые, но не оплаченные покупки.

На экране телефон маскируется. Полные телефон и имя выдаются только через CSV-маршрут с permission `subscriptions:analytics:export`; факт выгрузки записывается в admin audit без содержимого файла. Если журнал аудита недоступен, выгрузка блокируется. CSV обезвреживает также формулы после начальных пробелов и управляющих символов.

Новые открытия хранятся в `subscription_referral_link_events`, определения ссылок — в `subscription_referral_links`. Покупки читаются из существующего `lk_tournament_subscription_sales` по `referralLinkId`, `referralToken` или legacy `trainerQrCode`.

Новая покупка по `referralToken` засчитывается только если `referralVisitId` совпадает с записанным в ЦУП открытием той же ссылки не более чем за 30 дней до создания покупки. Это не даёт засчитать произвольно подставленный token. Для legacy-кодов `TR-001..TR-050` сохранён отдельный режим по точному `trainerQrCode`.

## API и RBAC

- `GET /api/v1/admin/referral-links` — `subscriptions:analytics:read`;
- `POST /api/v1/admin/referral-links` — `subscriptions:release:write`, обязателен `Idempotency-Key`;
- `PATCH /api/v1/admin/referral-links/:linkId` — `subscriptions:release:write`, optimistic `expectedRevision`;
- `GET /api/v1/admin/referral-links/:linkId/analytics` — `subscriptions:analytics:read`;
- `GET /api/v1/admin/referral-links/:linkId/export.csv` — `subscriptions:analytics:export`.

Новые permission не создавались. Назначение существующих прав конкретным ролям остаётся отдельным административным действием.

## Конфигурация и безопасное включение

Функция выключена по умолчанию:

```text
REFERRAL_LINKS_ENABLED=false
REFERRAL_LINKS_PUBLIC_BASE_URL=https://padlhub.su
REFERRAL_LINKS_ALLOWED_ORIGINS=https://padlhub.ru,https://www.padlhub.ru,https://padlhub.su
REFERRAL_LINKS_MONGODB_URI=
REFERRAL_LINKS_MONGODB_DB=
REFERRAL_LINKS_AUTO_CREATE_INDEXES=false
```

В production сначала проверить целевую БД `games` и backup, затем отдельным одобренным действием применить аддитивные индексы для ссылок, событий и существующей коллекции продаж:

```bash
npm run referral-links:indexes:check
REFERRAL_LINK_INDEX_APPLY=CONFIRM npm run referral-links:indexes:apply
npm run referral-links:indexes:check
```

После read-only проверки индексов можно отдельно включать `REFERRAL_LINKS_ENABLED=true`. Никакие команды из этого документа не запускаются автоматически.

## Rollback

1. Выключить `REFERRAL_LINKS_ENABLED` и вернуть предыдущий образ приложения.
2. Не удалять коллекции и индексы автоматически: они аддитивны и не влияют на старый runtime.
3. Сохранить link ID, период и результаты read-back для разбора.
4. Удаление или исправление данных выполнять только отдельным reviewed repair после backup и dry-run.

## Проверки перед выпуском

```bash
npm run test:referral-links
npm run test:auth-rbac
npm run build
```

Дополнительно проверить в тестовой БД: истёкшую/приостановленную ссылку, повтор `Idempotency-Key`, запрет чужого origin, маскирование телефона, permission экспорта, дневные границы и CSV в Excel/LibreOffice.
