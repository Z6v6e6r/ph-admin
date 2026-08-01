# Паттерны Playtomic, CourtReserve, Mindbody и ClubSpark

Статус: `FACT_EXTERNAL + ARCHITECTURE_PROPOSAL`
Проверено: 26 июля 2026 года

Документ фиксирует не маркетинговый список возможностей, а паттерны, которые меняют модель и контракты Scheduling Core.

## 1. Сводная матрица

| Система | Подтверждённый паттерн | Что принимаем в ЦУП |
|---|---|---|
| Playtomic | fixed/flexible availability, защита от непродаваемых окон, recurring series, `this event / this and following`, создание только свободных повторений, single/split payment и price update для серии | отдельный availability engine; gap policy; versioned series revisions; явный `PriceUpdateMode`; отчёт частично созданной серии |
| CourtReserve | разные семантики Reservation и Event, prime-time и membership restrictions, outstanding/concurrent limits, sandwich gaps, auto-assign, substitutes, несколько режимов waitlist и eligibility audit | `demandModel` внутри общего occurrence; versioned policy sets; quota counters; waitlist offer state machine; participant substitution; объяснимый отказ |
| Mindbody | classes/appointments/events на одном экране, total/online capacity, адресуемое место, room/equipment resources, self check-in, late cancel/no-show и многоканальная публикация | capacity pools; slot map; attendance/penalty saga; client context; единый календарь без отдельных движков |
| ClubSpark | несколько кортов в одном booking, admin booking on behalf, сезонные расписания и правила по ролям, recurring/block bookings, bulk cancel, guest fee, maintenance/closed и физический доступ | составные allocations; `actor ≠ beneficiary`; seasonal policy calendar; bulk impact plan; guest charge; access grant projection |

## 2. Playtomic: доступность важнее пустоты в календаре

### Наблюдение

Playtomic разделяет fixed и flexible reservation rules. Flexible-режим может разрешать либо предотвращать образование непродаваемых промежутков. Для recurring series поддерживаются изменение одного события или этого и последующих, а при конфликтах — создание только свободных повторений. Цена серии зависит от того, была ли она зафиксирована вручную или рассчитана по правилам.

Официальные источники:

- [Availability: Fixed & Flexible reservations](https://helpmanager.playtomic.com/hc/en-gb/articles/20535323617425-Availability-Fixed-Flexible-reservations)
- [How to add a reservation](https://helpmanager.playtomic.com/hc/en-gb/articles/20535410170769-How-to-add-a-reservation)
- [How to edit recurring reservations](https://helpmanager.playtomic.com/hc/en-gb/articles/20534255539473-How-to-edit-recurring-reservations)

### Решение ЦУП

Пустое место в сетке ещё не означает продаваемый слот. Вводится отдельный `Availability Engine`, который получает:

- рабочие интервалы и закрытия;
- allocations и buffers;
- duration options;
- fixed/flexible start rules;
- канал, сегмент клиента и membership;
- prime-time;
- gap policy;
- price/policy versions.

Он возвращает `SellableOption[]`, а не набор серых прямоугольников:

```text
startAt, endAt
resourcePlan[]
priceQuoteRef
policyEvaluationRef
expiresAt
reasonCodes[]
efficiencyScore
```

Политика промежутков имеет режимы:

- `ALLOW`;
- `WARN`;
- `BLOCK`;
- `BLOCK_UNTIL_BYPASS_WINDOW`.

Для серии отдельно фиксируются:

- область изменения;
- режим `ATOMIC | AVAILABLE_ONLY`;
- `PriceUpdateMode = KEEP_EXISTING | REPRICE_UNPAID | REPRICE_ALL_ALLOWED`;
- отчёт созданных, пропущенных и конфликтных occurrence.

## 3. CourtReserve: Reservation и Event — разные обещания

### Наблюдение

CourtReserve отличает прямую reservation ресурса от event с вместимостью, регистрацией и waitlist. Ограничения могут зависеть от membership, прайм-тайма, числа активных/дневных/недельных броней и нежелательных промежутков. Waitlist поддерживает минимум два режима: FIFO auto-registration и уведомление всех с получением места первым подтвердившим; есть cutoff, eligibility и audit причин пропуска.

Официальные источники:

- [Overview: Events](https://help.courtreserve.com/en/articles/6661065-overview-events)
- [Overview: Booking Settings](https://help.courtreserve.com/en/articles/12571361-overview-booking-settings)
- [Booking Settings: Restrictions](https://help.courtreserve.com/en/articles/8071325-booking-settings-restrictions)
- [Event Waitlists](https://help.courtreserve.com/en/articles/6601471-event-waitlists)

### Решение ЦУП

Сохраняется одно календарное ядро, но `ScheduleOccurrence.demandModel` обязательно:

- `RESOURCE_RESERVATION` — клиент резервирует конкретный ресурс/время;
- `REGISTRATION_EVENT` — клуб создаёт событие, а клиенты занимают места;
- `PROGRAM_SESSION` — occurrence принадлежит программе/курсу;
- `RESOURCE_CLOSURE` — ресурс недоступен без клиентской регистрации.

Это влияет на команды, capacity и cancellation, но не создаёт четыре реализации календаря.

`WaitlistEntry` дополняется `WaitlistOffer`:

```text
mode: FIFO_AUTO | FIRST_TO_CLAIM | ADMIN_APPROVAL
candidateId
slotRequirements
offeredAt
expiresAt
eligibilityEvaluationId
holdId?
state
skipReason?
```

Переход в roster происходит атомарно с временным hold места. Все пропуски кандидата имеют машинную причину в audit.

## 4. Mindbody: capacity — не одно число

### Наблюдение

Mindbody управляет classes, appointments и events из общего расписания, связывает staff, rooms и equipment, разделяет общую и доступную онлайн вместимость, поддерживает адресуемые места, waitlist, check-in и late-cancel/no-show policies.

Официальные источники:

- [Scheduling for Classes & Appointments](https://www.mindbodyonline.com/business/scheduling)
- [Mindbody Business pricing and resource management](https://www.mindbodyonline.com/business/pricing)
- [Mindbody Business App](https://www.mindbodyonline.com/business/business-app)

### Решение ЦУП

Вводится `CapacityPool`:

- `TOTAL`;
- `ONLINE`;
- `ADMIN_RESERVED`;
- `MEMBERSHIP_QUOTA`;
- `WAITLIST_BUFFER`.

Пулы не создают дополнительные физические места: их сумма и пересечения проверяются инвариантами.

Для адресуемых мест используется `SlotMap`:

- четыре позиции падел-игры;
- команды A/B;
- место в тренировочной группе;
- конкретное оборудование или зона;
- доступность для выбранного сегмента.

Check-in, late cancellation и no-show меняют attendance, затем создают команду в Entitlement/Ledger. Scheduling не списывает деньги самостоятельно.

## 5. ClubSpark: клубное расписание живёт сезонами и ролями

### Наблюдение

ClubSpark позволяет администратору бронировать от имени участника/гостя, выбирать несколько кортов, создавать recurring/block booking, использовать категории `Coaching`, `Competition`, `Maintenance`, `Closed`, массово отменять записи и задавать расписания/цены для разных ролей и периодов.

Официальные источники:

- [Booking a Court: Advanced Options](https://sportlabs.zendesk.com/hc/en-us/articles/202274949-Booking-a-Court-Advanced-Options)
- [Applying Booking Rules](https://sportlabs.zendesk.com/hc/en-us/articles/202856985-Applying-Booking-Rules)
- [Managing Your Booking Schedules](https://sportlabs.zendesk.com/hc/en-us/articles/360032749791-Managing-Your-Booking-Schedules)
- [Adding, Editing and Cancelling a Court Booking](https://sportlabs.zendesk.com/hc/en-us/articles/205586635-Adding-Editing-and-Cancelling-A-Court-Booking)

### Решение ЦУП

Команда различает:

- `actorId` — кто выполнил действие;
- `beneficiaryClientId` — для кого создана бронь;
- `organizerId` — кто управляет событием;
- `payerIds` — кто оплачивает;
- `participants` — кто использует ресурс.

`PolicySet` имеет период действия и scope:

```text
tenant / station / resource
event kind / demand model
channel
membership / role / client category
weekday / date range / time interval
priority
effectiveFrom / effectiveTo
```

Физический доступ моделируется как `AccessGrant` projection:

- создаётся только после допустимого lifecycle/payment состояния;
- ограничен ресурсом и временным окном;
- отзывается при отмене/переносе;
- хранит факт фактического использования в audit;
- не раскрывает PIN/credential в календарном DTO.

## 6. Что намеренно не копируем

- отдельные несогласованные движки для reservation, appointment, class и event;
- UI-правила, которые нельзя повторить через API;
- «оплачено» как необратимый checkbox;
- редактирование всей исторической серии при изменении будущих событий;
- waitlist без временного hold и защиты от двух победителей;
- расчёт доступности только на клиенте;
- скрытые channel-specific исключения;
- физическое удаление отменённой брони;
- использование цвета вместо статуса и причины.

## 7. Новые обязательные capability tests

1. Fixed 90-minute policy не создаёт лишние стартовые интервалы.
2. Flexible policy в режиме `BLOCK` не оставляет непродаваемое окно.
3. Одна серия изменяет только выбранное occurrence.
4. Изменение `this and following` создаёт новую ревизию без переписывания прошлого.
5. `AVAILABLE_ONLY` возвращает полный отчёт конфликтов.
6. Price update не меняет уже оплаченные обязательства без отдельной финансовой команды.
7. Prime-time quota одинакова в UI и API.
8. Online capacity может быть исчерпана при сохранённом admin reserve.
9. Waitlist `FIRST_TO_CLAIM` выдаёт место ровно одному участнику.
10. FIFO-кандидат с неподходящим entitlement пропускается с audit reason.
11. Substitute сохраняет историю исходного участника и финансовые обязательства.
12. Multi-court event резервирует все корты атомарно.
13. Bulk closure формирует impact plan до mutation.
14. Отмена/перенос отзывает старый access grant и создаёт новый только после подтверждения.
