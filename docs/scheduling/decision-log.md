# Журнал решений расписания

Статус: `DRAFT_FOR_REVIEW`

## Принятые архитектурные решения v0

| ID | Решение | Статус | Обоснование |
|---|---|---|---|
| SCH-001 | Создать отдельный Scheduling Core | `PROPOSED` | календарь должен обслуживать несколько UI и каналов |
| SCH-002 | `ScheduleOccurrence` — корень временного агрегата | `PROPOSED` | одно событие может иметь несколько клиентов, плательщиков и публикаций |
| SCH-003 | `BookingCommitment` отделён от occurrence | `PROPOSED` | клиентская бронь/место и занятие ресурса имеют разные инварианты |
| SCH-004 | Все ресурсы занимают `ResourceAllocation` | `PROPOSED` | корт, тренер и оборудование проверяются одним механизмом |
| SCH-005 | Точные start/end, шаг сетки только UI | `PROPOSED` | нужны 45/75/90 минут, буферы и переход суток |
| SCH-006 | Многомерные статусы | `PROPOSED` | один `status` не описывает жизнь, оплату, capacity, публикацию и sync |
| SCH-007 | Day Dispatcher — первый основной экран | `PROPOSED` | сохраняет операционную плотность Viva и добавляет действия/проблемы |
| SCH-008 | Правая панель вместо каскада модалок | `PROPOSED` | снижает потерю контекста и объединяет клиента, оплату и историю |
| SCH-009 | Один writer на boundary | `REQUIRED` | исключает двойную продажу ресурса |
| SCH-010 | Shadow read до mutation/cutover | `REQUIRED` | даёт измеримую parity и reconciliation |
| SCH-011 | Drag/drop использует общий command API | `REQUIRED` | не допускает отдельной облегчённой бизнес-логики браузера |
| SCH-012 | Красный только для проблем | `PROPOSED` | тип, статус и проблема не смешиваются одним цветом |
| SCH-013 | Доступность рассчитывает отдельный серверный engine | `PROPOSED` | пустой интервал может быть непродаваемым из-за duration, policy или gap |
| SCH-014 | Reservation/Event различаются через `demandModel` | `PROPOSED` | разные обещания клиенту без дублирования календарного ядра |
| SCH-015 | Capacity состоит из пулов и адресуемых slots | `PROPOSED` | online reserve, команды и конкретные места не описываются одним числом |
| SCH-016 | Waitlist использует offer + expiring hold | `PROPOSED` | защищает от двух победителей и делает skip объяснимым |
| SCH-017 | Серия изменяется новой revision | `PROPOSED` | прошлые occurrence и оплаченные цены остаются неизменяемыми |
| SCH-018 | Физический доступ — projection, не поле booking | `PROPOSED` | credential можно отозвать и проверить независимо от календарного DTO |

`REQUIRED` следует уже принятой архитектуре миграции ЦУП. `PROPOSED` требует продуктового подтверждения.

## Решения, требующие владельца

| ID | Вопрос | Варианты | Рекомендуемое решение | Владелец | Срок |
|---|---|---|---|---|---|
| SCH-Q01 | Pilot station | одна станция с типовой нагрузкой / самая сложная | типовая станция + отдельный сложный набор для тестов | Product + Operations | `TBD` |
| SCH-Q02 | Первая writer boundary | только аренда / аренда + тренировки / все типы | сначала read-only, затем аренда на одной station | Product + Engineering | `TBD` |
| SCH-Q03 | Основная ось | корты / тренеры / выбор пользователя | корты по умолчанию, переключаемая ось | Operations | `TBD` |
| SCH-Q04 | Шаг по умолчанию | 15 / 30 / 60 минут | 30 минут, точное время в данных | Operations | `TBD` |
| SCH-Q05 | Политика soft override | только управляющий / выбранные админы | permission + reason + audit | Security + Operations | `TBD` |
| SCH-Q06 | Transport live updates | SSE / WebSocket | выбрать после проверки текущей инфраструктуры; домен не зависит от транспорта | Engineering | `TBD` |
| SCH-Q07 | Источник цены на этапе Viva writer | Viva preview / локальная копия | только ответ canonical writer | Finance + Engineering | `TBD` |
| SCH-Q08 | Undo | компенсация до публикации / всегда | только явно обратимые команды, иначе новый impact preview | Product + Engineering | `TBD` |
| SCH-Q09 | Gap policy | hard block / warning / по периоду | prime-time `BLOCK`, off-peak `WARN`, configurable bypass window | Revenue + Operations | `TBD` |
| SCH-Q10 | Waitlist mode | FIFO / first-to-claim / admin | настраивать по event kind; default `FIRST_TO_CLAIM` для игр | Product + Operations | `TBD` |
| SCH-Q11 | Online capacity reserve | нет / число / процент | отдельный pool с cutoff возврата в общий capacity | Product + Revenue | `TBD` |
| SCH-Q12 | Series repricing | всегда / никогда / выбор | явный `KEEP_EXISTING | REPRICE_UNPAID` в первой версии | Finance + Product | `TBD` |

## Следующий продуктовый checkpoint

До детального визуального макета нужно подтвердить:

1. основной pilot station;
2. 5–7 реальных сценариев смены администратора;
3. типы событий первой версии;
4. обязательные KPI сводки;
5. состав правой панели;
6. writer boundary и допустимую задержку shadow projection;
7. финансовые последствия move/cancel.

После подтверждения создаётся кликабельный прототип трёх состояний:

- нормальный загруженный день;
- день с проблемами и sync failure;
- перенос события с impact preview и version conflict.
