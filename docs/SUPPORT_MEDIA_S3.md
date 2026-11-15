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
S3. Conditional PUT `If-None-Match:*`, одна попытка записи. Потерянный ACK сверяется
через HEAD (metadata SHA, bytes, JPEG type, непустая immutable VersionId).
Отсутствующая или `null` version отклоняется. Ссылки всегда подписываются для точной
версии. Ключ и scope не принимаются от браузера; HMAC signing key сохраняется при откате.

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
Реальная bucket versioning/conditional-write совместимость должна быть проверена
read-only и затем отдельно разрешённой synthetic записью до activation. Этот код
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

Зависимости AWS SDK, smithy handler и sharp совпадают с текущими версиями media
инфраструктуры LK2. `npm audit` при добавлении показал 13 уже существующих baseline
advisories; версии этих пакетов не изменились. Автоматический dependency upgrade не выполнялся.
