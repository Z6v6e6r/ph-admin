# Защита истории турниров после карантина IP

Зависит от PR #28. Эта поставка — код и проверяемая инструкция, не изменение production.
История принадлежит Node-RED; ЦУП отображает состояние, сигналы и позволяет вручную
перенести IP в существующий карантин. Новых публичных API и Mongo collections нет.

## Поведение и безопасные значения

- Модуль `dist/traffic/history-protection.js` — обычный Express middleware без внешних
  runtime dependencies. Установить один экземпляр в одном процессе Node-RED.
- `off` по умолчанию: полный pass-through. `shadow`: только счётчики/сигналы, исходные
  ответы не меняются, кеш не применяется. `enforce`: token bucket 120 запросов/мин,
  ёмкость 30; превышение возвращает JSON 429, Retry-After и Cache-Control: no-store.
- Лимит общий на IP по GET/HEAD `/lk/tournaments/americano/history`, включая trailing
  slash, кодированные пути, Authorization/Cookie, лишние/неоднозначные query. ID турнира
  не является ключом лимита. OPTIONS, export, иные маршруты и методы пропускаются.
- Источник 188.127.235.140, включая IPv4-mapped IPv6, не расходует лимиты, не попадает
  в кандидаты и получает свежий upstream-ответ вместо кеша.
- Дополнительный общий лимит аккаунта реализован через `verifiedSubject(request)`.
  Callback должен читать подтверждённый сервером контекст ПОСЛЕ authentication.
  В существующем публичном Node-RED history этого контекста нет: пример его не выдумывает
  и не включает. ЦУП показывает, подключён ли account limiter. Нельзя брать subject из
  заголовка, query, телефона или просто декодированного JWT. Изменять public auth не требуется.
- Сигналы: >100 разных tournamentId за 10 минут, >=500 запросов/мин, >=10 ответов 5xx,
  >=10 обрывов либо >=10 ответов дольше 2 секунд за последнее окно. IP остаётся кандидатом для
  ручной проверки, автоматического карантина нет. Режим shadow нужен для калибровки
  NAT, нескольких вкладок, табло и интеграций до ограничения.

## IP и middleware chain

По умолчанию IP берётся из socket.remoteAddress; X-Forwarded-For игнорируется.
`trustLoopbackProxy: true` разрешает X-Real-IP только от 127.0.0.1/::1. В nginx обязателен
`proxy_set_header X-Real-IP $remote_addr` с корректно настроенными trusted real_ip hops;
входной X-Real-IP должен перезаписываться. Не доверять произвольному XFF/CDN hop.
Другие proxy topology требуют отдельного адаптера/проверки, не расширения доверия на всех.
Неопределённый IP пропускается с видимым счётчиком: нельзя блокировать весь ЛК под одним
неверным адресом nginx. Серверные порты должны иметь проверенный ingress-контракт.

Существующие CORS/auth middleware должны выполняться раньше guard: сохраняются CORS и
проверенный контекст, в том числе для 429. `deploy/traffic/nodered-history.example.cjs`
компонует функции/массив middleware и functionGlobalContext, не заменяет settings.js.
Проверить поддержку middleware array точной версией Node-RED и все текущие обработчики.
Неподдержанный existing middleware/global name вызывает явный отказ конфигурации.

## Кеш и гонки

Кеш отдельно opt-in: `enableCache: true` И `publicHistoryConfirmed: true`, только enforce.
В начале включается исключительно shadow; затем rate limiting; кеш — отдельный шаг.
Требуется повторно подтвердить public response contract на актуальном runtime. Source
history читает Mongo document напрямую и может содержать публично возвращаемые имена,
телефоны и ID: тела хранятся ТОЛЬКО в ограниченной RAM, никогда в status/логах/файлах.
Это не добавляет новые данные в публичный ответ и не заменяет отдельную работу по DTO/privacy.

- Только GET с единственным скалярным tournamentId и без других query.
- Authorization, Cookie, identity/custom headers, условные/Range/no-cache запросы
  обходят кеш. Host, Origin, Accept/Language/Encoding разделяют ключи.
- Только JSON 200 ограниченного размера; Set-Cookie, Vary, Content-Encoding,
  private/no-store/no-cache, ошибки, 304, 404 и не-JSON не кешируются/не разделяются.
- TTL по умолчанию 2 секунды, hard maximum 5 секунд. Долгого кеша завершённых турниров
  пока нет: не все writers работают через HTTP. Cache hit отдаёт тот же body, безопасный
  набор representation/CORS headers и no-store для downstream caches.
- Одновременные подходящие запросы объединяются до получения ответа. Если лидер
  вернул неподходящий ответ, followers идут в исходный upstream независимо.
- Начало/окончание любого mutating HTTP инвалидирует кеш и меняет generation; пока
  есть активные записи, кеш обходится. Старый read не может заново заполнить кеш после
  записи. Метод/URL/body/status/payments при этом не меняются и не читаются guard.
- `global.get('phabHistoryProtection').invalidate()` доступен подключённым Node-RED
  writers. Для отдельных Mongo repair/finalize/resume процессов это не интеграция:
  отключать кеш перед такими работами либо подключать доказанную invalidation.
- Проверить реальный Mongo acknowledgement → HTTP response для обоих save/results
  маршрутов: старый экспорт отвечал параллельно Mongo. HTTP finish/abort не доказывает
  commit или rollback. Допускается ограниченная TTL задержка, строгая консистентность
  не обещается. Node-RED источник графа перед релизом — актуальный flow с 147.

## Ограничение ресурсов и отказы

На процесс: 2 000 IP и 2 000 account buckets, не более 101 недавно виденного ID на IP
при стандартном threshold, cache 500 entries/32 MiB, один response <=1 MiB, 64 inflight
лидера и <=32 followers/ключ. Ожидание followers <=2 секунд, затем исходный upstream.
Capture лидера прекращается через 5 секунд без отмены исходного запроса: память/flight
освобождаются, поздний ответ не заполняет кеш. Обрывы учитываются отдельно от HTTP5xx.
Кеш вытесняет старые записи, expiry и TTL не продлеваются cache hits.
При заполнении таблицы новых источников применяется общий ограниченный overflow bucket;
фиксируется capacityFallback. Account quota продолжает проверяться независимо от IP slot.
Это может затронуть новые обычные IP при атаке; распределённый обход требует edge/WAF.
При рестарте счётчики/лимиты/кеш сбрасываются. Никакой перезаписи nginx или live ACL.

Rate/TTL используют монотонные часы, heartbeat — wall clock. Origin max-age/s-maxage
может только сократить TTL; Age/Expires/Pragma обходят кеш.

Метрики запросов агрегируются поминутно: окно 10–11 минут на границе минут; distinct ID
хранятся как SHA256 не более 10 минут, счётчик ≥101 — нижняя оценка. IP и причины доступны
только тем же глобальным traffic:read ролям. Raw URL/query/headers/body/subject не пишутся.

## Подключение и наблюдение после отдельного одобрения релиза

1. Зафиксировать source SHA, успешные tests/build/CI, preimages settings и middleware,
   точный Node/Node-RED runtime, CORS, proxy IP, HTTP writers и rollback custody.
2. Доставить единственный built JS модуль по immutable root-owned пути
   `/opt/phab-traffic/runtime/history-protection.js`. Runtime Node >=20. Не доставлять
   тесты, source exports, local logs, node_modules или production credentials.
3. Создать `/var/lib/phab-history-protection` с владельцем службы Node-RED и группой,
   позволяющей ЦУП только чтение, 2750. Режим отчёта 0640. ЦУП и другие пользователи
   не могут изменять runtime JS или настройки. Дать ЦУП `TRAFFIC_HISTORY_REPORT_FILE`
   со значением `/var/lib/phab-history-protection/status.json`.
4. Скомпоновать settings примером с mode shadow и проверенным proxy contract. Сохранить
   все предыдущие CORS/auth middleware. После разрешённого рестарта проверить реальные
   public GET, HEAD, OPTIONS, save/results, персональные чтения и платёжные маршруты.
5. Status атомарно обновляется каждые 15 секунд без блокирования HTTP. ЦУП читает его
   каждые 15 секунд на открытой вкладке; возраст >=90 секунд — stale. Ошибка/нет файла/
   повреждённый новый отчёт не ломают существующий API карантина. Счётчики с запуска,
   сигналы — текущее окно независимо от выбранной даты топ-20.
6. За 24–48 часов shadow оценить wouldLimit, кандидатов, медленные ответы, NAT/табло и
   исключения. Отдельно разрешить enforce с cache=false; затем public cache при наличии
   всех gate доказательств. Никаких реальных подозрительных IP автоматически не внесено.
7. Проверить тревоги не только по запросам: identityUnavailable, identityResolverErrors,
   capacityFallback, telemetryErrors, stale report. UI показывает проблемы. Внешний монитор
   может проверять age файла; email/Telegram/Slack и внешние сообщения не подключены.

Rollback: вернуть предыдущую middleware композицию либо mode off, убрать только этот
optional adapter и выполнить разрешённый restart. Это прекращает rate/cache/signals,
но НЕ снимает nginx-карантин из PR #28. Для него отдельный документированный rollback.
После рестарта проверить прежние response semantics и отсутствие новых 429. Исходные
записи турниров и оплаты не меняются и не требуют отката данных.

## Проверки

`npx ts-node test/history-protection.test.ts` — synthetic real HTTP integration.
`npx ts-node test/traffic.test.ts` — permission/CSRF/CAS и isolation optional report.
`npm run test:auth-rbac`, `npm run build`, existing Python/nginx quarantine tests.
CI выполняет те же runtime tests на Linux плюс существующий exact-head suite с локальной
Mongo. UI проверяется отдельно в desktop/mobile. Всё это не является live acceptance.
