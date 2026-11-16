# Закрытые фото поддержки

Source change для ручных фото ЦУП/ЛК1 и входящих MAX. Production activation,
конфигурация ключей, bucket/IAM изменения и реальные тестовые сообщения требуют
отдельного разрешения. Существующие S3/LK2 business endpoints не изменяются.

## Хранение и API

Новые ручные фото проходят raster magic/type validation, JPEG re-encode, EXIF strip,
40 MP cap, resize до 1600 px и ограничение байтов до любой Mongo business write.
До 10 фото, 4 MiB source/file, 12 MiB source total, 3 MiB normalized/file и 12 MiB
normalized total. Два concurrent prepare, 20 s общий media budget и 5 s image operation.
Браузер ЛК1 применяет более строгие 1 MiB/file и 2 MiB total.

`cup-support/v1/<scopeHMAC>/<contentSHA256>.jpg` — отдельный private prefix существующего
S3. Для каждой фотографии создаётся новый scope: HMAC от owner и отдельного
`crypto.randomUUID()` с разделителем `\0upload\0`. Даже одинаковые фото в одном
сообщении или повтор после перезапуска получают разные ключи. Дедупликации объектов нет.
Приложение выполняет один PUT для каждого нового key; `If-None-Match:*` остаётся
дополнительной защитой. В synthetic проверке Timeweb 16 ноября 2026 повторный PUT
вернул200 вместо412: сохранность истории не должна зависеть от соблюдения этого условия.
Потерянный ACK сверяется только через HEAD того же key (metadata SHA, bytes, JPEG type,
непустая VersionId), без повторного PUT или нового key в этой операции.
Отсутствующая или `null` version отклоняется. Ссылки всегда подписываются для точной
версии. Ключ и scope не принимаются от браузера; HMAC signing key сохраняется при откате.
Четырёхполевой v1 reference и его reader не меняются: ранее сохранённые deterministic
scopes продолжают читаться. Обычные загрузки приложения не перезаписывают прежние keys,
поэтому не переводят их versions в noncurrent. Существующая lifecycle-политика для
noncurrent versions не меняется; overwrite/delete другим владельцем доступа всё ещё
может сделать старую version noncurrent. Эта схема не восстанавливает уже удалённые versions.

Mongo получает только небольшой `mediaRef`/`mediaScope`, name, size, MIME и ID.
Для MAX inbound исходный provider `url` сохраняется, чтобы не нарушить строгий
receiver persistence confirmer; response reader использует отдельный ref.
Обычные HTTP responses получают свежую ссылку на 300 s и `Cache-Control: private,
no-store`, internal fields удаляются из копии. Ingest receipt остаётся внутренним
точным wire binding; он не используется как browser display payload.
Подпись выполняется локально со static credentials и не обращается к S3 при lease.
SDK обновляет display signatures/cache и получает свежую историю при открытии,
сохранении и ошибке загрузки фото; это read-only, без повторной отправки.

Новые internal endpoints:

- `POST /api/support/media/prepare`: только inline photos и server-generated
  `WEB_LK:<Node-RED nonce>`; возвращает server refs до прежнего LK1 Mongo writer.
- `POST /api/support/media/resolve`: до 300 bounded projected refs из уже прочитанной
  Node-RED истории; возвращает только index/id/signed URL. Не принимает произвольный key.

Оба требуют configured media integration token и constant-time comparison. Фото
MAX/LK ingest дополнительно требует `x-support-media-token` (fallback на переданный
старый integration token), когда feature включена. Connector/alias определяется
тем же resolver, что и business ingestion. Общая legacy ingress policy не меняется.
Неверный auth не может вызвать download/PUT/business writes. Non-MAX/non-LK ingress
и disabled-feature provider photos сохраняют прежний контракт.
Raw ingress всегда отвергает `cup-media:` URL и наличие internal ref/scope полей
до любых writes, независимо от connector/feature flag. Нельзя сохранить forged ref,
который впоследствии блокировал бы чтение страницы истории.

## Конфигурация

| Переменная | Значение / требование |
| --- | --- |
| `SUPPORT_MEDIA_ENABLED` | `true` только после готовности инфраструктуры и recovery |
| `SUPPORT_MEDIA_S3_ENDPOINT` | существующий HTTPS S3 endpoint |
| `SUPPORT_MEDIA_S3_BUCKET`, `SUPPORT_MEDIA_S3_REGION` | существующий private versioned bucket/region |
| `SUPPORT_MEDIA_S3_ACCESS_KEY_ID`, `SUPPORT_MEDIA_S3_SECRET_ACCESS_KEY` | отдельные ограниченные server credentials |
| `SUPPORT_MEDIA_S3_FORCE_PATH_STYLE` | `true` только если требует провайдер |
| `SUPPORT_MEDIA_SIGNING_KEY` | стабильный секрет минимум 32 символа; хранить прежний при recovery |
| `SUPPORT_MEDIA_INTEGRATION_TOKEN` | dedicated service token; fallback на configured global token |
| `SUPPORT_MEDIA_MAX_IMAGE_HOSTS` | exact MAX image hosts, default только `i.oneme.ru` |
| `SUPPORT_MEDIA_TEMPLATE_IMAGE_HOSTS` | exact trusted template hosts, default пусто |
| `SUPPORT_MEDIA_UPLOADS_ENABLED` | `false` прекращает новые uploads, reader продолжает работать |

Не выводить значения в логи/PR. Prefix permissions: PUT и metadata HEAD своего prefix,
versioned GET; без list всего bucket, delete, ACL, lifecycle и versioning writes.
Реальная приватность, versioning и чтение точной version должны быть проверены
read-only и затем отдельно разрешённой synthetic записью до activation. Для провайдера,
игнорирующего conditional writes, отдельно проверить разные keys одинаковых фото и
чтение первого ref после повторных загрузок. Этот код
не включает versioning и не расширяет права автоматически.

MAX remote download: exact hostname, TLS, public IPv4 DNS pin, abortable DNS,
bounded response, без redirects и bot Authorization. Автоответы с фото при enabled
MAX проходят тот же путь только из inline или explicitly allowed template hosts,
проверяются до enqueue и после ожидания повторно сверяют DB/cache/recipient.
При отказе сохраняется accepted inbound, service message/outbox не создаются,
логируется фиксированный `SUPPORT_AUTO_REPLY_MEDIA_UNAVAILABLE`. Caption отдельно
не отправляется. До activation инвентаризировать шаблоны; неподдерживаемые фото
нужно повторно прикрепить. Ручной external URL отклоняется до записи с таким пояснением.

Receiver с `mediaIngressToken` использует 90 s CUP POST budget и 120 s stop budget:
text тоже может вызвать photo auto-reply. Старый7 s deadline для такой конфигурации
недопустим. Node-RED media prepare ждёт 30 s, display resolve — 7 s. Committed LK1
POST остаётся accepted при отказе display grant; raw refs в response/debug не уходят.

При частичном upload до ошибки возможен невостребованный immutable объект. Его
автоматическое удаление и чистка старых файлов в feature не входят. История,
старая held queue и удалённый архив1041 не восстанавливаются/не переотправляются.

## Recovery и включение

`prepare-cup-runtime-release.mjs` собирает Linux Node22 candidate и отдельный полный
`media-recovery-runtime.tgz` из baseline83 с закрытым reviewed source patch.
Архив включает AWS/sharp native dependencies, SDK и media reader. Source closure:
19 явно перечисленных файлов; executable closure: 17 файлов. Unrelated executables
обязаны совпадать. Изменение порядка inferred type unions допускается только после
AST equivalence; unrelated declaration bytes затем восстанавливаются из baseline.

SDK recovery сохраняет проверенную версию фото из `40e13d9`, вместе с историческим
интерфейсом результатов ФПР. Candidate содержит отдельно выпущенный Figma-интерфейс.
Эта единственная пара SDK закреплена двумя SHA-256; произвольный SDK, изменение
recovery SDK или расхождение серверных executable файлов блокируют сборку.
Возврат на исторический интерфейс ФПР при recovery — явное ограничение отката.

Исторический пятифайловый MAX overlay остаётся pinned к reviewed source `db68…` и
помечен `supportMediaReader:false`. После первого нового фото он и старый3cc не являются
совместимым rollback target. Не применять новый full runtime старым delta-only installer.
Проверить inventory, manifest/hash, runtime Node, конфигурацию, custody/queue и exact
target release tree перед любым separately authorized cutover.

В recovery сохранить S3 credentials/signing key и refs. `UPLOADS_ENABLED=false`
оставляет чтение, но новые фото будут отклонены/потребуют разбора durable inbox;
это containment, а не прозрачное продолжение фотообмена. Не делать слепой rollback
backend/config поверх новых media references. Не менять архив или held commands.

Порядок: подготовить infrastructure/config и receiver budget → candidate/recovery →
ЦУП → Node-RED media bridge/controlled sender+worker binding → LK1/SDK → разрешённый
provider/UI E2E и restart. До этого source/local/CI не объявляются production delivery.

### Первый выход из CUP3cc с legacy очередью

`scripts/lib/cup3cc-max-cutover.mjs` — ограниченный source-first operational primitive
для уже загруженного `3cc47088`, не автоматический deploy. Он сохраняет пять Maps
поддержки двумя private/fsynced копиями и устанавливает существующий terminal
`legacyMaxClosing`. Это live mutation; запуск требует отдельно разрешённой выкладки
и владельца окна. Прототипы/три функции, PID/start/timeOrigin/Node, legacy/sync0,
отсутствие таймеров, unheld MAX PENDING/LEASED0 и tracked writes/failures0 проверяются
до изменения. Для закреплённого3cc допустим только отсутствующий env mode (штатный
`maxOutboxMode()` возвращает legacy) либо точное `legacy`. Другие строки, включая
пустую и whitespace, отклоняются; окружение процесса не изменяется. Это не снимает
требование failures0 и не разрешает сброс накопленных ошибок. Метод не запускает
hydrate/import, не меняет held/archive и не посылает сообщения. Само добавление файла в репозиторий ничего в приложении не включает.

Перед вызовом custodian обязан проверить полное immutable inventory старого runtime
и exact loaded script bytes, владение Inspector/release lock, paused+idle receiver,
известные producer/edge fences и сохранённый журнал текущих запросов. Прототипы должны
происходить из уже загруженных проверенных модулей: нельзя загрузить другой класс и
объявить его текущим. Файлы custody хранят персональные данные только на сервере,
root-owned0700/0600, вне Git и model output. Исходный snapshot и intent записываются
до closing; потеря ACK или ошибка любой записи означает UNKNOWN, без повторного вызова.

Это fence принятия MAX-команд, **не HTTP drain и не отсутствие business writes**.
Все legacy MAX enqueue проходят через tracked write; closing отклоняет их до durable
action и Map acceptance. Поздний handler всё ещё может сохранить сообщение/диалог
перед отказом enqueue. Проверять cohort STAFF и delivery-eligible SYSTEM, auto-replies
и notifications; не переотправлять UNKNOWN автоматически. Флаг terminal для старого
процесса, не сбрасывается для «пробного продолжения».

После fence обязательны повторные Map/Set и majority DB проверки всех физических
outbox stores: удаление tracked promise может предшествовать Map continuation. Только
после стабильных нулей и сохранения истории допускается stop. После PID/cgroup0 нужен
ещё один majority open0 и cohort/history postcheck **до запуска candidate**. Любой open
row, неизвестный commit, late continuation или orphan блокирует activation: сохранять
custody, producers paused, без parking/replay/старого sync0 hydration. Primitive receipt
намеренно содержит `activationAdmitted:false`. Совместимый full media recovery и его
ключи должны быть готовы до terminal fence; сам primitive recovery не выполняет.

## Проверки

`npm run test:support-photos`, support identity/history/cold-reply compatibility,
MAX receipts/durable/restart/custody tests на owned isolated Mongo, `npm run build`.
CI строит candidate/recovery на Linux Node22 и проверяет source/compiled parity,
compiled media-reader restart и MAX custody. Не требуется реальный provider call.

Общий deterministic backend packager повторно устанавливает production dependencies
через `npm ci` без scripts, сохраняя package/lock bytes. Два Linux x64 native файла
sharp/libvips допускаются только при совпадении exact path, version, locked SRI и
reviewed SHA-256; отсутствие или изменение файла блокирует artifact. После production
install выполняется локальный 2px JPEG encode probe. Type declarations dependencies
в runtime не копируются; сканирование всех включённых файлов остаётся обязательным.
Optional WASM fallback, который дополнительно устанавливает npm11.1, исключён из
Linux x64 runtime; encode probe выполняется уже на окончательном filtered stage,
чтобы WASM не мог скрыть неисправность native binding. Допуска остальных binary нет.

Зависимости AWS SDK, smithy handler и sharp совпадают с текущими версиями media
инфраструктуры LK2. `npm audit` при добавлении показал 13 уже существующих baseline
advisories; версии этих пакетов не изменились. Автоматический dependency upgrade не выполнялся.
