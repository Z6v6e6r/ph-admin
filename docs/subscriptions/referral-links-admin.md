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

### Immutable release packet

Production candidate собирается только из чистого checkout с закреплённым полным SHA и
в новый абсолютный каталог вне репозитория. Его существующий parent должен быть
canonical, принадлежать текущему uid и не быть writable для group/world:

```bash
npm run referral-links:release:build -- \
  --expected-head <exact-40-char-sha> \
  --output /absolute/new/release-output
```

Builder создаёт private source snapshot через `git archive` exact SHA, выполняет в нём
`npm ci --ignore-scripts` и production build, проверяет отсутствие Git drift, включает
`dist/`, `package.json` и `package-lock.json`, создаёт `release-manifest.json` с SHA-256
каждого файла и архив с companion `.sha256`. `.env`, credentials и runtime backup в
packet не входят. Manifest закрепляет dark-launch defaults
`REFERRAL_LINKS_ENABLED=false`, `REFERRAL_LINKS_AUTO_CREATE_INDEXES=false` и
`buildSource=PRIVATE_GIT_ARCHIVE`; test-only bypass production builder не имеет.

Перед переносом и после него packet проверяется независимо:

```bash
REFERRAL_RELEASE_ARCHIVE=/absolute/phab-referral-....tar.gz \
REFERRAL_RELEASE_ARCHIVE_SHA256=<approved-archive-sha256> \
REFERRAL_RELEASE_SOURCE_SHA=<exact-40-char-sha> \
npm run referral-links:release:verify
```

Эти команды не устанавливают systemd unit, не переключают active release, не меняют
production env и не перезапускают приложение.

### Referral data backup and recovery verification

Backup охватывает только три коллекции, которые создаются или индексируются этим
выпуском: definitions, events и существующие subscription sales. Имена берутся из
`REFERRAL_LINKS_COLLECTION`, `REFERRAL_LINK_EVENTS_COLLECTION` и
`REFERRAL_LINK_SALES_COLLECTION`, поэтому production overrides также входят в target
attestation.

```bash
npm run referral-links:backup:target-fingerprint

REFERRAL_LINKS_BACKUP_EXPECTED_DB=games \
REFERRAL_LINKS_BACKUP_TARGET_SHA256=<approved-credential-free-target-sha256> \
REFERRAL_LINKS_BACKUP_ROOT=/absolute/private/backup-root \
npm run referral-links:backup:check

REFERRAL_LINKS_BACKUP_CREATE=CONFIRM \
REFERRAL_LINKS_BACKUP_SOURCE_UNIT=<exact-active-unit.service> \
REFERRAL_LINKS_BACKUP_SOURCE_RELEASE_DIR=<exact-active-release-dir> \
REFERRAL_LINKS_BACKUP_SOURCE_SHA=<exact-active-40-char-sha> \
npm run referral-links:backup:create
```

Create разрешён только root, требует exact Mongo target fingerprint, active runtime
identity, существующий root-owned каталог с mode `0700` и пишет private archive `0600`.
В manifest сохраняются existence/count/index metadata и SHA-256 NDJSON/index payload
каждой коллекции. URI и credentials в manifest/stdout не попадают.

Recovery-readiness проверяется без записи в Mongo:

```bash
REFERRAL_LINKS_BACKUP_ARCHIVE=/absolute/private/backup.tar.gz \
REFERRAL_LINKS_BACKUP_ARCHIVE_SHA256=<approved-archive-sha256> \
REFERRAL_LINKS_BACKUP_EXPECTED_DB=games \
REFERRAL_LINKS_BACKUP_TARGET_SHA256=<approved-target-sha256> \
REFERRAL_LINKS_BACKUP_EXPECTED_SOURCE_UNIT=<approved-unit.service> \
REFERRAL_LINKS_BACKUP_EXPECTED_SOURCE_RELEASE_DIR=<approved-release-dir> \
REFERRAL_LINKS_BACKUP_EXPECTED_SOURCE_SHA=<approved-40-char-sha> \
npm run referral-links:backup:verify
```

Verifier потоково пересчитывает member SHA/counts и отклоняет неожиданные пути или
файлы, non-regular tar entries и несовпадение отдельно закреплённого source identity.
Поля source в backup имеют статус `DECLARED_NOT_LIVE_ATTESTED`: эти команды сами не
проверяют active systemd unit/ExecStart и не являются runtime provenance evidence.
Такая live-аттестация остаётся обязательным отдельным release gate. Verifier не печатает
документы и не выполняет restore. Любой production restore или data repair остаётся
отдельным reviewed действием после dry-run на изолированной БД.

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
