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
  реплик: перед горизонтальным масштабированием потребуется общий transactional store.
- В той же атомарной записи сохраняется аудит: автор, IP, действие, причина, время,
  revision. До 1000 правил, до 5000 событий и 1.8 MB. При заполнении новые изменения
  отклоняются до контролируемого архивирования; история не удаляется автоматически.
- Root-owned helper читает JSON как недоверенный ввод; допускает только canonical
  exact IPv4/IPv6. Нет CIDR, hostname, scoped IPv6, shell interpolation или root-команд
  из API. Loopback/private/link-local адреса также запрещены для карантина.
- Каждую минуту helper применяет эффективные неистёкшие правила, выполняет `nginx -t`,
  reload, затем проверяет digest через фиксированный loopback `127.0.0.1:18147`.
  При неудаче восстанавливает предыдущий файл и перезагружает предыдущую конфигурацию.
  Ошибка остаётся в receipt, а предыдущая подтверждённая revision не переименовывается
  в новую. При аварии между шагами следующий запуск повторяет применение/readback.
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
