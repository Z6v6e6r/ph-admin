# Трафик и карантин IP в ЦУП

## Поведение

Вкладка «Трафик и карантин» показывает топ-20 IP за выбранные московские сутки:
число HTTP-запросов без OPTIONS, расписание, турниры/историю, участников,
отбрасывания, ошибки 5xx и максимальное число запросов за минуту. OPTIONS считаются
отдельно. Известный источник `188.127.235.140` виден в статистике как разрешённый;
API и обработчик nginx независимо запрещают его блокировку, включая IPv4-mapped IPv6.
Статистика охватывает только подключённые nginx vhost, а не прямые обращения к Viva.

Администратор выбирает IP из топа или вводит его вручную, указывает причину и срок
(24 часа, 7 или 30 дней в UI; API допускает до 90 дней). Можно продлить правило
или снять его с обязательной причиной. Никакого автоматического добавления по
объёму запросов и никаких заранее внесённых подозрительных IP.

Область первого запуска: публичные GET/HEAD расписания и турниров.
Поддержаны `/lk/games`, `/lk/games/by-phone` с public/available/find и значениями
true/1/yes/available/find, включая URL-кодирование; `/lk/tournaments`,
`/lk/tournaments/americano/history`, `/lk/tournaments/participants` и
`/lk/games/:id/participants`. Неоднозначные повторные/структурные public flags
консервативно считаются публичным запросом, если содержат разрешающее значение.
Обычные запросы по phone/clientId без public flags, авторизация, оплаты,
POST/PATCH/DELETE и OPTIONS не отбрасываются. Это не блокировка всего ЛК.
При изменении public-mode контракта LK1 необходимо обновить edge selector и e2e.

nginx возвращает **444**, закрывая соединение без тела и передачи в upstream.
Это снижает нагрузку Node-RED/Mongo, но сетевой клиент может заметить закрытие.
Отбрасывание не является обещанием незаметной блокировки. TLS и запись компактного
access log остаются нагрузкой edge.

## Архитектура и контракт

- `GET /api/traffic?day=YYYY-MM-DD`: политика, подтверждение nginx и дневной отчёт.
- `POST /api/traffic/quarantine`: `{action: add|remove, revision, ip, reason, expiresAt}`.
  `revision` обязателен; конфликт возвращает 409. Успех означает сохранение, а не применение.
- Новые `traffic:read`/`traffic:write`: по умолчанию только SUPER_ADMIN через `*`.
  Для делегированной роли нужен глобальный scope именно соответствующего permission.
  Legacy headers не принимаются. Cookie mutation требует Origin, точно совпадающий
  с `TRAFFIC_ADMIN_ORIGIN`; reflected CORS приложения не заменяет этот guard.
- Один экземпляр ЦУП на одном сервере. Durable JSON, межпроцессный lock-directory,
  CAS revision, временный файл, fsync, atomic rename. Не использовать NFS/несколько
  пишущих реплик: перед горизонтальным масштабированием потребуется общий transactional store.
- В той же атомарной записи сохраняется аудит: автор, IP, действие, причина, время,
  revision. До 1000 правил, до 5000 событий и 1.8 MB. При заполнении новые изменения
  отклоняются до контролируемого архивирования; история не удаляется автоматически.
- Root-owned helper читает JSON как недоверенный ввод; допускает только canonical
  exact IPv4/IPv6. Нет CIDR, hostname, scoped IPv6, shell interpolation или root-команд
  из API. Loopback/private/link-local адреса также запрещены для карантина.
- Каждую минуту helper применяет эффективные неистёкшие правила, выполняет `nginx -t`,
  reload, затем проверяет digest через фиксированный loopback `127.0.0.1:18147`.
  Digest включает версию протокола, revision и эффективный список IP: прежний worker
  с пустым списком не может подтвердить снятие более поздней блокировки. Изменение
  списка при истечении срока также меняет digest без новой административной revision.
  При неудаче восстанавливает предыдущий файл и перезагружает предыдущую конфигурацию.
  Ошибка остаётся в receipt, а предыдущая подтверждённая revision не переименовывается
  в новую. При аварии между шагами следующий запуск повторяет применение/readback.
  Sync unit допускает до 180 секунд, включая проверку, reload, readback и полный откат;
  это не обещает отмену запросов, уже принятых прежними nginx workers.
- Отдельный collector каждые 5 минут обновляет SQLite и JSON отчёты, включая вчера.
  В 00:10 Europe/Moscow таймер также запускает пересчёт вчерашнего дня. Persistent
  timer догоняет пропущенный запуск. Он работает на сервере независимо от Codex.

## Подключение после одобрения конкретного релиза на 147

Эти файлы не подключены к production автоматически. До изменения ingress выполнить
обычные release gates проекта: утверждённый source/artifact, свежие nginx/service
preimages, подтверждённая топология, rollback и окно наблюдения.

1. Проверить `nginx -T`, реальные public vhost и все location с собственными
   `access_log`/`access_log off`, существующий logrotate, свободный loopback 18147.
   Проверить фактический IP клиента и доверенные proxy hops. `$remote_addr` нельзя
   заменять первым элементом произвольного клиентского X-Forwarded-For. При CDN
   сначала отдельный проверенный real_ip/trusted-proxy контракт.
2. Разместить immutable helper в `/opt/phab-traffic/traffic-edge.py`, root:root,
   без возможности записи приложением. Python3 использует только stdlib, SQLite.
3. Создать отдельную группу `phab-traffic`. Реального пользователя службы ЦУП добавить
   в неё. Каталог `/var/lib/ph-admin/traffic`: владелец пользователь ЦУП, группа
   phab-traffic, mode 2750; `quarantine.json`: 0640, первоначально точная копия
   `deploy/traffic/quarantine.example.json`. **Нельзя перезаписывать существующий файл.**
4. `/var/lib/phab-traffic`: root:phab-traffic, 0750; `reports/`: root:phab-traffic,
   2750. Приложение имеет только чтение reports; SQLite, helper lock и receipts пишет
   root helper. `/etc/nginx/phab-traffic`: root:root, 0755, недоступен для записи ЦУП.
   Bootstrap `policy.conf` получить `render_policy` из пустого example, не из списка
   подозрений. Пустой файл без определений переменных не является валидным bootstrap.
5. Подключить `http.conf` в http context, `server.conf` — только к нужным public
   vhost. Если location имеет свой access_log, добавить туда отдельный phab_traffic
   access_log: nginx не наследует родительские записи в этом случае. На каждый
   запрос должна приходиться ровно одна запись нового журнала. Существующие журналы
   сохраняются. На служебном loopback listener access_log отключён.
6. Конфигурация ЦУП (новые переменные; не секреты):

   ```text
   TRAFFIC_ADMIN_ENABLED=true
   TRAFFIC_ADMIN_ORIGIN=https://padlhub.su
   TRAFFIC_POLICY_FILE=/var/lib/ph-admin/traffic/quarantine.json
   TRAFFIC_REPORT_DIR=/var/lib/phab-traffic/reports
   ```

   Origin должен совпадать с фактическим адресом админки. По умолчанию функция
   выключена; существующие API/запуск не создают хранилища и не меняют nginx.
7. После `nginx -t` и одобренного reload сначала проверить пустую политику.
   Установить unit/timer файлы из `deploy/traffic/`; подключить logrotate, предварительно
   сверив владельцев журнала (`www-data:adm` в примере) и исключив двойную ротацию
   общим `/var/log/nginx/*.log` правилом. Используется rename/reopen, **не copytruncate**.
8. Запустить sync и collect, проверить receipts, `systemctl list-timers`, JSON вчера/
   сегодня и отдельный nginx журнал. Проверить права от имени пользователя ЦУП:
   policy read/write; reports только read; `/etc/nginx` и helper не writable.
9. Только после одобрения конкретного тестового IP провести внешний probe на каждом
   public vhost: blocked public GET не попал в Node-RED, ровно один sanitized log,
   счётчик вырос, обычные phone lookup/POST/OPTIONS доступны, защищённый источник
   доступен, снятие правила возвращает 200. Digest подтверждает geo, **не подключение
   server.conf и полную цепочку маршрутизации**; без этих probes нет live acceptance.

## Мониторинг, полнота и восстановление

- Просмотр: «Трафик и карантин», дата по Москве, по умолчанию вчера. Текущий день
  частичный. Первый день после подключения и даты до начала сбора явно отмечаются
  как неполные. Нет отчёта — отсутствие данных, а не нулевой трафик.
- В UI отдельно видны неподтверждённая политика (heartbeat старше 3 минут), ошибки
  загрузки и устаревший отчёт за сегодня/вчера (15 минут). После остановки helper
  nginx продолжает last-known-good: автоматическое истечение правил требует живого
  sync timer, поэтому expiry при outage может задержаться. Оператору нужно восстановить
  timer либо выполнить утверждённый rollback; нельзя обещать истечение при остановке.
- Внешнее оперативное наблюдение должно алертить failure unit и возраст edge receipt
  >180 секунд, collector report >15 минут. Эта поставка отображает проблему в ЦУП;
  email/Telegram/Slack уведомления не подключает.
- Отдельный журнал содержит только request ID, время, IP, метод из enum, категорию
  маршрута, status, bytes, blocked. Нет URL/параметров/Referer/cookie/token/телефонов.
  События до 14 rotations (daily/maxsize 100 MB; для строгого лимита проверять logrotate
  чаще одного раза в сутки). Агрегаты/JSON — 90 дней, без автоматической блокировки.
- Collector читает один dedicated stream с cursor по fingerprint первой строки
  (в ней nginx request_id), устойчив к rename/gzip/replay/неполной последней строке.
  SQLite counts, cursor и pending reports фиксируются вместе; большие файлы имеют
  checkpoints. После падения уже учтённые запросы не дублируются, pending days публикуются
  повторно. Два независимых/deduplicated nginx лога сюда не направлять.
- Потерянные/удалённые исходные логи восстановить из backup до backfill. Не объявлять
  такие дни полными по одному факту успешного запуска. Сбой разбора виден отдельным
  счётчиком rejectedLinesTotal; журнальные данные не подставляются в нулевые результаты.
- Нет файла/повреждён JSON: API отказывает, helper сохраняет подтверждённые правила.
  Восстановить проверенную preimage, сохранить монотонность revision. После crash API
  проверить отсутствие живого writer; только затем удалить оставшийся `.lock` каталог.
  Самостоятельного «устаревшего lock => удалить» нет, чтобы не разрушить живую запись.
- Rollback: остановить sync timer, сохранить policy/audit/receipt, вернуть предыдущую
  утверждённую nginx конфигурацию или проверенную пустую geo policy, `nginx -t`, reload,
  проверить public paths и отсутствие отбрасываний. Отключение одного
  TRAFFIC_ADMIN_ENABLED **не снимает** уже загруженную nginx политику. После rollback
  не включать sync с прежним непустым desired state. Файлы статистики можно оставить.

## Локальная проверка

```sh
npx ts-node test/traffic.test.ts
python3 test/traffic-edge.test.py
python3 test/traffic-replica.test.py
python3 test/traffic-nginx.test.py /absolute/path/to/nginx
node --check client-sdk/phab-admin-panel.js
npm run test:auth-rbac
npm run build
```

nginx e2e использует ephemeral localhost ports и синтетический upstream. Только fixture
доверяет X-Fixture-IP как адресу тестового прокси; production не получает этот header
контракт. Тест проверяет aliases/encoding, zero upstream calls при 444, protected IP,
private read/POST/OPTIONS, reload/readback/removal, sanitized logs и actual aggregation.
Для реального Mongo/production эти команды не являются проверкой: новая функция
вообще не создаёт Mongo collection/index и не меняет существующую auth persistence.

## Резервный вход 89: локальное применение общей политики

ЦУП на 147 остаётся единственным writer. На 89 нет второго ЦУП, доступа к Mongo,
копии аудита или нового административного SSH-ключа. `traffic-replica.py export`
каждые 30 секунд публикует только `version`, `revision`, `rules[{ip,expiresAt}]`
и `sourceGeneratedAt`. Каталог `/var/lib/phab-traffic-export` — root:root 0755,
файл `policy.json` — root:root 0644; исходный файл ЦУП сохраняет прежние права.
Экспорт проверяет защищённые адреса и монотонность revision. Адреса обоих общих
прокси `147.45.103.3` и `89.108.64.209` дополнительно запрещены в реплике.
Эти два адреса нельзя добавлять в ЦУП: существующий writer их специально не
исключает, а exporter отвергнет такую политику целиком и сохранит прежний snapshot.
Ошибка экспорта и расхождение revision требуют исправления правила оператором.

`replication-source.conf` подключается **только** к HTTPS server `padlhub.su`.
Точный адрес `/__phab_traffic_policy` отдаёт статический snapshot только соединению
с `89.108.64.209`; остальным — 403, запись и выполнение команд отсутствуют.
GET/HEAD разрешены, POST запрещён; `Cache-Control: no-store`, ETag/304 выключены.
Перед активацией проверить отсутствие унаследованного real_ip-контракта, который
позволил бы произвольному клиенту подменить адрес соединения. На 89 и 147
карантин продолжает использовать `$remote_addr`, а не клиентские XFF/X-Real-IP.
До включения экспорта добавить `replication-reserve.conf` во все public server89:
этот exact path возвращает 404 и никогда не проксируется. Иначе внешний клиент
мог бы заимствовать разрешённый source IP89 через публичный прокси. Двухзвенный
nginx e2e проверяет также URL-кодирование и нормализацию этого пути.

На 89 установить из одного immutable source SHA оба Python helper, прежние
`http.conf`/`server.conf` и logrotate, новые `phab-traffic-replica.service/.timer`.
Отдельный `phab-traffic-sync.timer` на 89 **не включать**. Реплика сама запускает
локальный sync под тем же `.sync.lock`. Сборщик можно подключить прежними collect
units; он пишет отдельный поток и собственные отчёты 89.

Каждую минуту резерв получает фиксированный HTTPS URL с проверкой TLS CA/hostname,
без proxy env/redirect, не более 1 MB и с общим deadline 12 секунд. Snapshot старше
180 секунд, из будущего дальше 60 секунд, повреждённый JSON/повторные ключи,
защищённые IP и понижение revision отвергаются. Прежняя revision с изменёнными
правилами тоже отвергается. Корневой файл `/var/lib/phab-traffic/replica/policy.json`
(каталог 0700, файл 0640) — watermark **последней принятой** версии, даже если
последующее применение nginx не удалось. Новая версия записывается fsync/rename.

После ошибки передачи локальный sync всё равно проверяет сроки и readback прежних
правил. Ошибка не очищает карантин и не продлевает срок. Но снятие/добавление правила
во время разрыва связи дойдёт до 89 только после восстановления связи; выключенный
timer задерживает и expiry. При исправных таймерах обычная задержка — до примерно
90 секунд плюс время reload. Не обещать синхронное применение на двух входах.

`reports/replica-status.json` раздельно содержит sourceGeneratedAt/sourceFetchedAt,
receivedRevision и appliedRevision, fetchError/applyError; `edge-status.json`
подтверждает локальный nginx. Неудачная передача оставляет прежний sourceFetchedAt
и завершает unit ошибкой **после** попытки локального применения. Проверять возраст
sourceGeneratedAt и локального receipt, состояния export/replica timers и журнал
ошибок. Текущая вкладка ЦУП и её top-20/receipt относятся к **147**: она не объединяет
статистику прокси и не подтверждает 89. Отчёты 89 проверяются отдельно, суммирование
двух журналов без устранения дублей недопустимо. Доставка внешних alerts не включена.

Порядок активации: сохранить nginx preimages и hashes обоих серверов; проверить
candidate и rollback конфигурации в изоляции; сначала подключить deny endpoint
во всех public vhost89 и выбранный API vhost с пустой bootstrap geo, сохранив старые
access_log/CORS/proxy настройки. Проверить 404 на89, затем поставить exporter и
закрытый location147; проверить TLS fetch с89 и403 с другого IP; получить актуальный
snapshot на89; `nginx -t → reload → digest`; включить timers; проверить отдельные receipts
и доступные public health/OPTIONS, затем реальные отбрасывания в sanitized журнале.
Изолированный nginx e2e проверяет 444 без upstream, HEAD, разрешённый188, приватные
reads, POST/OPTIONS/CORS, служебный ACL и подмену forwarding headers.

Откат расширения: остановить новые timers/services; сохранить policy/receipts/logs;
вернуть только изменённые nginx vhost/includes по CAS preimages, проверить и reload;
отключить добавленный export endpoint. Исходные policy, backend, основной sync и
collect на 147 сохраняются. Реплику с прежним непустым desired state после отката
автоматически не запускать. Артефакты и evidence не удалять.
