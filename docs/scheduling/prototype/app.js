const START_HOUR = 8;
const END_HOUR = 23;

const courts = [
  { name: "Корт №1", hint: "Свободен с 16:00" },
  { name: "Корт №2", hint: "Свободен с 13:00" },
  { name: "Корт №3", hint: "Свободен с 18:00" },
  { name: "Корт №4", hint: "Свободен с 17:00" },
  { name: "Открытый корт №5", hint: "Свободен с 16:30" },
  { name: "Открытый корт №6", hint: "Свободен с 18:00" },
];

const events = [
  { id: "e01", court: 0, start: 9, duration: 90, type: "personal", category: "training", title: "Персональная · Дмитрий", meta: "Тренер Павел · 1/1", source: "Viva", payment: "Оплачено" },
  { id: "e02", court: 0, start: 11, duration: 120, type: "game", category: "game", title: "Открытая игра 2×2", meta: "3/4 · D+2–C2", source: "ЦУП", issue: "Нужен 1 игрок", issueType: "roster" },
  { id: "e03", court: 0, start: 14, duration: 120, type: "game", category: "game", title: "Открытая игра 2×2", meta: "4/4 · C1–C2", source: "ЦУП" },
  { id: "e04", court: 0, start: 17, duration: 60, type: "group", category: "training", title: "Игра + тренер · D", meta: "3/3 · Павел", source: "Viva" },
  { id: "e05", court: 0, start: 18.25, duration: 60, type: "group", category: "training", title: "Групповая тренировка", meta: "4/4 · Уровень D", source: "Viva" },
  { id: "e06", court: 0, start: 19.25, duration: 100, type: "tournament", category: "tournament", title: "PadlHub Americano", meta: "12/12 · 4 корта", source: "ЦУП" },
  { id: "e07", court: 0, start: 21.25, duration: 105, type: "game", category: "game", title: "Открытая игра 2×2", meta: "3/4 · D+", source: "ЦУП" },

  { id: "e08", court: 1, start: 8, duration: 60, type: "group", category: "training", title: "Групповая · D", meta: "2/4 · Мария", source: "Viva" },
  { id: "e09", court: 1, start: 9.25, duration: 60, type: "group", category: "training", title: "Сплит D+", meta: "2/3 · Алексей", source: "Viva" },
  { id: "e10", court: 1, start: 12, duration: 30, type: "blocked", category: "blocked", title: "Технический перерыв", meta: "Сетка и свет", source: "ЦУП" },
  { id: "e11", court: 1, start: 14, duration: 60, type: "group", category: "training", title: "Сплит D", meta: "2/3 · Денис", source: "Viva" },
  { id: "e12", court: 1, start: 15.333, duration: 60, type: "group", category: "training", title: "Сплит D", meta: "2/3 · Денис", source: "Viva", issue: "1 200 ₽ к оплате", issueType: "payment" },
  { id: "e13", court: 1, start: 16.583, duration: 60, type: "game", category: "game", title: "Игра + тренер · C", meta: "3/3 · Мария", source: "ЦУП" },
  { id: "e14", court: 1, start: 17.75, duration: 60, type: "group", category: "training", title: "Групповая · C/C+", meta: "4/4 · Алексей", source: "Viva" },
  { id: "e15", court: 1, start: 21.167, duration: 110, type: "game", category: "game", title: "Открытая игра 2×2", meta: "1/4 · D", source: "ЦУП" },

  { id: "e16", court: 2, start: 8, duration: 60, type: "group", category: "training", title: "Сплит D+", meta: "2/3 · Илья", source: "Viva" },
  { id: "e17", court: 2, start: 9.167, duration: 60, type: "game", category: "game", title: "Игра + тренер · D", meta: "2/3 · Павел", source: "ЦУП" },
  { id: "e18", court: 2, start: 11, duration: 60, type: "game", category: "game", title: "Игра + тренер · D+", meta: "3/3 · Илья", source: "ЦУП" },
  { id: "e19", court: 2, start: 12.25, duration: 60, type: "game", category: "game", title: "Открытая игра 2×2", meta: "4/4 · C1", source: "ЦУП" },
  { id: "e20", court: 2, start: 14, duration: 60, type: "personal", category: "training", title: "Персональная · Эля", meta: "Тренер Анна · 1/1", source: "Viva" },
  { id: "e21", court: 2, start: 15.25, duration: 60, type: "game", category: "game", title: "Игра + тренер · D", meta: "2/3 · Павел", source: "ЦУП" },
  { id: "e22", court: 2, start: 16.583, duration: 60, type: "game", category: "game", title: "Игра + тренер · D", meta: "3/3 · Павел", source: "ЦУП", issue: "Сбой синхронизации Viva", issueType: "sync" },
  { id: "e23", court: 2, start: 17.75, duration: 60, type: "group", category: "training", title: "Групповая · D", meta: "4/4 · Мария", source: "Viva" },
  { id: "e24", court: 2, start: 21.25, duration: 105, type: "game", category: "game", title: "Открытая игра 2×2", meta: "2/4 · D+", source: "ЦУП" },

  { id: "e25", court: 3, start: 8, duration: 90, type: "personal", category: "training", title: "Игра 2×2 · гости", meta: "+7 964 635-03-75", source: "Viva" },
  { id: "e26", court: 3, start: 10, duration: 60, type: "game", category: "game", title: "Игра + тренер · D+", meta: "2/3 · Павел", source: "ЦУП" },
  { id: "e27", court: 3, start: 12, duration: 60, type: "tournament", category: "training", title: "Первая пробная", meta: "0/2 · Мария", source: "Viva" },
  { id: "e28", court: 3, start: 14, duration: 60, type: "game", category: "game", title: "Игра + тренер · D", meta: "3/3 · Павел", source: "ЦУП" },
  { id: "e29", court: 3, start: 15.25, duration: 60, type: "group", category: "training", title: "Сплит D", meta: "2/3 · Павел", source: "Viva" },
  { id: "e30", court: 3, start: 16.583, duration: 60, type: "tournament", category: "training", title: "Первая пробная", meta: "0/2 · Мария", source: "Viva" },
  { id: "e31", court: 3, start: 18.25, duration: 60, type: "group", category: "training", title: "Групповая · D+", meta: "4/4 · Алексей", source: "Viva" },
  { id: "e32", court: 3, start: 20.25, duration: 90, type: "personal", category: "training", title: "Игра 2×2 · Ирина", meta: "Гости · 1/4", source: "Viva", issue: "Изменено другим администратором", issueType: "version" },

  { id: "e33", court: 4, start: 15, duration: 90, type: "game", category: "game", title: "Открытая игра 2×2", meta: "4/4 · D+", source: "ЦУП" },
  { id: "e34", court: 4, start: 18.5, duration: 90, type: "personal", category: "training", title: "Игра 2×2 · Андрей", meta: "Гости · 1/4", source: "Viva" },
  { id: "e35", court: 4, start: 20.25, duration: 75, type: "personal", category: "training", title: "Игра 2×2 · Ирина", meta: "Гости · 1/4", source: "Viva" },
  { id: "e36", court: 4, start: 21.917, duration: 75, type: "personal", category: "training", title: "Игра 2×2 · Андрей", meta: "Гости · 1/4", source: "Viva" },
  { id: "e37", court: 5, start: 20.25, duration: 90, type: "personal", category: "training", title: "Игра 2×2 · Ирина", meta: "Гости · 1/4", source: "Viva" },
];

const BASE_DATE = new Date(2026, 6, 27);
const PROTOTYPE_NOW = new Date(2026, 6, 27, 15, 32);

const state = {
  mode: "normal",
  selectedId: null,
  filter: "all",
  search: "",
  hourHeight: 84,
  dayOffset: 0,
  createDraft: null,
  moveDraft: null,
  draggedId: null,
};

const dom = {
  body: document.body,
  calendarLayout: document.querySelector(".calendar-layout"),
  courtHeaders: document.getElementById("courtHeaders"),
  courtsGrid: document.getElementById("courtsGrid"),
  timeAxis: document.getElementById("timeAxis"),
  nowLine: document.getElementById("nowLine"),
  drawer: document.getElementById("drawer"),
  kpiStrip: document.getElementById("kpiStrip"),
  toast: document.getElementById("toast"),
  calendarScroll: document.getElementById("calendarScroll"),
  scheduleSearch: document.getElementById("scheduleSearch"),
  dateLabel: document.getElementById("dateLabel"),
  filtersPopover: document.getElementById("filtersPopover"),
};

function selectedDate() {
  const date = new Date(BASE_DATE);
  date.setDate(date.getDate() + state.dayOffset);
  return date;
}

function isToday() {
  return state.dayOffset === 0;
}

function formatTime(value) {
  const hours = Math.floor(value);
  const minutes = Math.round((value - hours) * 60);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function formatDate(date, full = false) {
  return new Intl.DateTimeFormat("ru-RU", {
    weekday: full ? undefined : "short",
    day: "numeric",
    month: "long",
    year: full ? "numeric" : undefined,
  })
    .format(date)
    .replace(".", "");
}

function relativeDayLabel() {
  if (state.dayOffset === 0) return "Сегодня";
  if (state.dayOffset === 1) return "Завтра";
  if (state.dayOffset === -1) return "Вчера";
  return formatDate(selectedDate());
}

function eventDate(event, end = false) {
  const date = selectedDate();
  const value = event.start + (end ? event.duration / 60 : 0);
  const hours = Math.floor(value);
  const minutes = Math.round((value - hours) * 60);
  date.setHours(hours, minutes, 0, 0);
  return date;
}

function temporalState(event) {
  const start = eventDate(event);
  const end = eventDate(event, true);
  if (PROTOTYPE_NOW >= start && PROTOTYPE_NOW < end) return "current";
  if (PROTOTYPE_NOW >= end) return "past";
  return "future";
}

function relativeStart(event) {
  const status = temporalState(event);
  if (status === "current") return "Идёт сейчас";
  const minutes = Math.max(1, Math.round(Math.abs(eventDate(event) - PROTOTYPE_NOW) / 60000));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const value = `${hours ? `${hours} ч ` : ""}${rest ? `${rest} мин` : ""}`.trim();
  return status === "future" ? `через ${value}` : `завершилось ${value} назад`;
}

function renderHeaders() {
  dom.courtHeaders.innerHTML = courts
    .map(
      (court) => `
        <div class="court-head">
          <div><strong>${court.name}</strong><small>${court.hint}</small></div>
          <span class="court-status"><i></i> Работает</span>
        </div>
      `,
    )
    .join("");
}

function renderTimeAxis() {
  const totalHeight = (END_HOUR - START_HOUR) * state.hourHeight;
  dom.timeAxis.style.height = `${totalHeight}px`;
  dom.timeAxis.innerHTML = Array.from({ length: END_HOUR - START_HOUR + 1 }, (_, index) => {
    const hour = START_HOUR + index;
    return `<span class="time-label" style="top:${index * state.hourHeight}px">${String(hour).padStart(2, "0")}:00</span>`;
  }).join("");
  dom.nowLine.style.top = `${(15 + 32 / 60 - START_HOUR) * state.hourHeight}px`;
  dom.nowLine.hidden = !isToday();
}

function isEventVisible(event) {
  const filterMatches =
    state.filter === "all" ||
    (state.filter === "training" && event.category === "training") ||
    event.category === state.filter;
  const searchMatches = `${event.title} ${event.meta} ${event.source}`
    .toLowerCase()
    .includes(state.search.toLowerCase());
  return filterMatches && searchMatches;
}

function eventMarkup(event) {
  const top = (event.start - START_HOUR) * state.hourHeight + 3;
  const height = Math.max(28, (event.duration / 60) * state.hourHeight - 6);
  const status = temporalState(event);
  const severity = ["sync", "version"].includes(event.issueType) ? "critical" : "warning";
  const classes = [
    "event-card",
    event.issue ? "attention" : "",
    event.issue ? severity : "",
    state.selectedId === event.id ? "selected" : "",
    state.moveDraft?.id === event.id ? "moving" : "",
    status,
    isEventVisible(event) ? "" : "filtered-out",
  ]
    .filter(Boolean)
    .join(" ");
  const issue = event.issue ? `<span class="event-issue">⚠ ${event.issue}</span>` : "";
  const current = status === "current" ? `<span class="current-badge">● Идёт сейчас</span>` : "";
  const secondary = height > 52 ? `<span class="event-meta">${event.meta}</span>` : "";
  const resize = event.type !== "blocked" && height > 54 ? `<span class="resize-handle" title="Изменить продолжительность"></span>` : "";
  return `
    <button
      class="${classes}"
      type="button"
      data-event-id="${event.id}"
      data-type="${event.type}"
      data-severity="${severity}"
      draggable="${event.type !== "blocked"}"
      style="top:${top}px;height:${height}px"
      aria-label="${formatTime(event.start)} ${event.title}${event.issue ? `, проблема: ${event.issue}` : ""}"
    >
      <span class="event-topline">
        <span class="event-time">${formatTime(event.start)}–${formatTime(event.start + event.duration / 60)}</span>
        <span class="event-source" title="Источник: ${event.source}">↗ ${event.source}</span>
      </span>
      <strong>${event.title}</strong>
      ${current}
      ${secondary}
      ${issue}
      ${resize}
    </button>
  `;
}

function timeFromPointer(column, clientY) {
  const rect = column.getBoundingClientRect();
  const raw = START_HOUR + (clientY - rect.top) / state.hourHeight;
  return Math.max(START_HOUR, Math.min(END_HOUR - 0.5, Math.round(raw * 2) / 2));
}

function showSlotPreview(column, courtIndex, start, kind = "create") {
  dom.courtsGrid.querySelectorAll(".slot-preview").forEach((preview) => preview.remove());
  const preview = document.createElement("div");
  preview.className = `slot-preview ${kind}`;
  preview.style.top = `${(start - START_HOUR) * state.hourHeight + 3}px`;
  preview.style.height = `${state.hourHeight - 6}px`;
  preview.dataset.court = courtIndex;
  preview.dataset.start = start;
  preview.textContent =
    kind === "drop"
      ? `${formatTime(start)}–${formatTime(start + 1)} · ${courts[courtIndex].name}`
      : `＋ Создать ${formatTime(start)}–${formatTime(start + 1)}`;
  column.append(preview);
}

function bindResize(button, event) {
  const handle = button.querySelector(".resize-handle");
  if (!handle) return;
  handle.addEventListener("pointerdown", (pointerEvent) => {
    pointerEvent.preventDefault();
    pointerEvent.stopPropagation();
    const startY = pointerEvent.clientY;
    const original = event.duration;
    const originalHeight = button.offsetHeight;
    const onMove = (moveEvent) => {
      const delta = Math.round(((moveEvent.clientY - startY) / state.hourHeight) * 2) * 30;
      const next = Math.max(30, Math.min(180, original + delta));
      button.style.height = `${Math.max(28, (next / 60) * state.hourHeight - 6)}px`;
      button.dataset.previewDuration = next;
    };
    const onUp = () => {
      const next = Number(button.dataset.previewDuration || original);
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      if (next !== original) {
        event.duration = next;
        renderGrid();
        showToast(`Продолжительность изменена: ${original} → ${next} мин`, "Отменить", () => {
          event.duration = original;
          renderGrid();
        });
      } else {
        button.style.height = `${originalHeight}px`;
      }
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp, { once: true });
  });
}

function renderGrid() {
  const totalHeight = (END_HOUR - START_HOUR) * state.hourHeight;
  dom.courtsGrid.innerHTML = courts
    .map(
      (_, courtIndex) => `
        <div class="court-column" data-court="${courtIndex}" style="height:${totalHeight}px">
          ${events.filter((event) => event.court === courtIndex).map(eventMarkup).join("")}
        </div>
      `,
    )
    .join("");

  dom.courtsGrid.querySelectorAll("[data-event-id]").forEach((button) => {
    const event = events.find((item) => item.id === button.dataset.eventId);
    button.addEventListener("click", () => openEvent(button.dataset.eventId));
    button.addEventListener("dragstart", () => {
      state.draggedId = button.dataset.eventId;
      dom.body.classList.add("dragging-event");
    });
    button.addEventListener("dragend", () => {
      state.draggedId = null;
      dom.body.classList.remove("dragging-event");
      dom.courtsGrid.querySelectorAll(".slot-preview").forEach((preview) => preview.remove());
    });
    bindResize(button, event);
  });

  dom.courtsGrid.querySelectorAll(".court-column").forEach((column) => {
    const courtIndex = Number(column.dataset.court);
    column.addEventListener("mousemove", (event) => {
      if (state.draggedId || event.target.closest(".event-card")) return;
      showSlotPreview(column, courtIndex, timeFromPointer(column, event.clientY));
    });
    column.addEventListener("mouseleave", () => {
      if (!state.draggedId) column.querySelector(".slot-preview")?.remove();
    });
    column.addEventListener("click", (event) => {
      if (event.target.closest(".event-card")) return;
      const preview = column.querySelector(".slot-preview.create");
      if (preview) openCreateDrawer(courtIndex, Number(preview.dataset.start));
    });
    column.addEventListener("dragover", (event) => {
      if (!state.draggedId) return;
      event.preventDefault();
      showSlotPreview(column, courtIndex, timeFromPointer(column, event.clientY), "drop");
    });
    column.addEventListener("drop", (event) => {
      event.preventDefault();
      const movedEvent = events.find((item) => item.id === state.draggedId);
      const preview = column.querySelector(".slot-preview.drop");
      if (!movedEvent || !preview) return;
      state.moveDraft = {
        id: movedEvent.id,
        newCourt: courtIndex,
        newStart: Number(preview.dataset.start),
      };
      state.selectedId = movedEvent.id;
      openDrawer();
      renderMoveDrawer(movedEvent, state.moveDraft);
      renderGrid();
    });
  });
}

function renderKpis() {
  dom.kpiStrip.innerHTML = `
    <button type="button" data-target="load"><strong>Загрузка 72%</strong><span>67 из 93 корт-часов</span></button>
    <button class="attention-summary" type="button" data-target="attention">
      <strong>⚠ Требуют внимания 4</strong><span>1 синхронизация · 2 оплаты · 1 недобор</span>
    </button>
    <button type="button" data-target="windows"><strong>5 окон от 60 минут</strong><span>Ближайшее 16:00 · Корт №5</span></button>
    <span class="freshness"><i></i> Данные актуальны · 18 сек.</span>
  `;
  dom.kpiStrip.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => {
      if (button.dataset.target === "attention") setMode("attention");
      else if (button.dataset.target === "windows") {
        dom.calendarScroll.scrollTop = (15.5 - START_HOUR) * state.hourHeight;
        showToast("Показано ближайшее продаваемое окно: 16:00 · Корт №5");
      } else showToast("Открыт аналитический срез загрузки");
    });
  });
}

function drawerShell({ kicker, title, subtitle, body, actions, activeTab = "Основное", type = "game", status = "Подтверждено" }) {
  return `
    <div class="drawer-head" data-type="${type}">
      <div class="drawer-head-row">
        <div><p class="drawer-kicker">${kicker}</p><h2>${title}</h2></div>
        <button class="drawer-close" type="button" aria-label="Закрыть">×</button>
      </div>
      <p class="drawer-subtitle">${subtitle}</p>
      <span class="drawer-status">${status}</span>
    </div>
    <div class="drawer-tabs">
      ${["Основное", "Участники", "Оплата", "Лист ожидания", "История"]
        .map((tab) => `<button class="${tab === activeTab ? "active" : ""}" type="button">${tab}</button>`)
        .join("")}
    </div>
    <div class="drawer-body">${body}</div>
    <div class="drawer-actions">${actions}</div>
  `;
}

function primaryAction(event) {
  if (event.issueType === "sync") return ["resolve", "Разрешить конфликт"];
  if (event.issueType === "version") return ["refresh", "Обновить данные"];
  const status = temporalState(event);
  if (status === "current") return ["attendance", "Отметить приход"];
  if (status === "past") return ["result", "Внести результат"];
  if (event.issueType === "payment") return ["payment", "Принять оплату"];
  return ["participant", "Добавить участника"];
}

function drawerActions(event) {
  const [action, label] = primaryAction(event);
  return `
    <button class="secondary-button" type="button" data-action="edit">Изменить</button>
    <button class="confirm" type="button" data-action="${action}">${label}</button>
    <button class="more-action" type="button" data-action="toggle-more" aria-label="Другие действия">•••</button>
    <div class="event-more-menu" hidden>
      <button type="button" data-action="duplicate">Дублировать</button>
      <button type="button" data-action="move">Перенести</button>
      <button type="button" data-action="publish">Изменить публикацию</button>
      <button type="button" data-action="cancel-event">Отменить</button>
      <button type="button" data-action="open-viva">Открыть в Viva</button>
      <button type="button" data-action="technical">Технические данные</button>
    </div>
  `;
}

function renderEventDrawer(event) {
  const severity = ["sync", "version"].includes(event.issueType) ? "critical" : "warning";
  const versionNotice =
    event.issueType === "version"
      ? `<section class="attention-card critical"><h3>Событие изменено другим сотрудником</h3><p>Анна Смирнова внесла изменения 12 секунд назад.</p><button type="button" data-action="refresh">Обновить данные</button></section>`
      : "";
  const body = `
    ${versionNotice}
    ${
      event.issue && event.issueType !== "version"
        ? `<section class="attention-card ${severity}"><h3>${severity === "critical" ? "Критическая проблема" : "Требуется действие"}</h3><div class="detail-grid"><span>Причина</span><strong>${event.issue}</strong><span>Срок</span><strong>${relativeStart(event)}</strong></div></section>`
        : ""
    }
    <section class="info-card">
      <h3>Детали события</h3>
      <div class="detail-grid">
        <span>Дата</span><strong>${formatDate(selectedDate(), true)}</strong>
        <span>Время</span><strong>${formatTime(event.start)}–${formatTime(event.start + event.duration / 60)}</strong>
        <span>Ресурс</span><strong>${courts[event.court].name}</strong>
        <span>Источник</span><strong>${event.source}</strong>
        <span>Версия</span><strong>v18 · актуальна</strong>
      </div>
      <div class="status-row"><span class="status-pill good">Подтверждено</span><span class="status-pill">${event.meta.split(" · ")[0]}</span><span class="status-pill ${event.issueType === "payment" ? "warn" : "good"}">${event.payment || "Частично оплачено"}</span></div>
    </section>
    <h3 class="drawer-section-title">Участники и роли</h3>
    <div class="person-row"><span class="avatar">АС</span><div><strong>Анна Смирнова</strong><small>Организатор · плательщик</small></div><b>Подтверждено</b></div>
    <div class="person-row"><span class="avatar">МК</span><div><strong>Михаил Котов</strong><small>Участник · команда B</small></div><b>Оплачено</b></div>
    <section class="info-card"><h3>Следующее рекомендуемое действие</h3><div class="detail-grid"><span>Состояние</span><strong>${relativeStart(event)}</strong><span>Уведомления</span><strong>Доставлены 3/3</strong></div></section>
  `;
  dom.drawer.innerHTML = drawerShell({
    kicker: event.category === "game" ? "ОТКРЫТАЯ ИГРА" : "РАСПИСАНИЕ",
    title: event.title,
    subtitle: `${relativeDayLabel()} · ${formatTime(event.start)}–${formatTime(event.start + event.duration / 60)} · ${courts[event.court].name}`,
    body,
    actions: drawerActions(event),
    type: event.type,
    status: temporalState(event) === "current" ? "● Идёт сейчас" : event.issue ? "Требует внимания" : "Подтверждено",
  });
  bindDrawerActions(event);
}

function renderAttentionDrawer() {
  const event = events.find((item) => item.id === "e22");
  const body = `
    <section class="attention-card critical"><h3>Ошибка синхронизации</h3><div class="detail-grid"><span>Срок</span><strong>${relativeStart(event)}</strong><span>ЦУП</span><strong>Версия v18</strong><span>Viva</span><strong>Версия v17</strong></div></section>
    <section class="info-card"><h3>Рекомендуемое решение</h3><div class="detail-grid"><span>Сохранить</span><strong>Время и состав ЦУП</strong><span>Перезаписать</span><strong>Версию Viva</strong><span>Уведомления</span><strong>Не требуются</strong></div><div class="status-row"><span class="status-pill good">Слот свободен</span><span class="status-pill warn">Нужно подтверждение</span></div></section>
    <h3 class="drawer-section-title">Очередь проблем по срочности</h3>
    <div class="slot-card critical"><span class="avatar">1</span><div><strong>Ошибка синхронизации</strong><small>Корт №3 · ${relativeStart(event)}</small></div><b>Критично</b></div>
    <div class="slot-card"><span class="avatar">2</span><div><strong>Не принята оплата</strong><small>Корт №2 · идёт сейчас</small></div><span class="status-pill warn">1 200 ₽</span></div>
    <div class="slot-card"><span class="avatar">3</span><div><strong>Недобор состава</strong><small>Открытая игра · 3 из 4</small></div><span class="status-pill warn">1 игрок</span></div>
  `;
  dom.drawer.innerHTML = drawerShell({
    kicker: "ПРОБЛЕМА №1 ИЗ 4",
    title: event.title,
    subtitle: `${relativeDayLabel()} · ${formatTime(event.start)} · ${courts[event.court].name}`,
    body,
    actions: drawerActions(event),
    type: event.type,
    status: "Критическая проблема",
  });
  bindDrawerActions(event);
}

function renderMoveDrawer(event, draft = { newCourt: 3, newStart: 18 }) {
  const priceChanged = draft.newStart >= 18;
  const body = `
    <section class="impact-card">
      <h3>Перенос события</h3>
      <div class="impact-flow">
        <div class="impact-place"><small>Сейчас</small><strong>${formatTime(event.start)}–${formatTime(event.start + event.duration / 60)}<br>${courts[event.court].name}</strong></div>
        <div class="impact-arrow">→</div>
        <div class="impact-place new"><small>Новый слот</small><strong>${formatTime(draft.newStart)}–${formatTime(draft.newStart + event.duration / 60)}<br>${courts[draft.newCourt].name}</strong></div>
      </div>
    </section>
    <section class="info-card"><h3>Последствия до подтверждения</h3><div class="detail-grid"><span>Цена</span><strong>${priceChanged ? "2 400 ₽ → 3 200 ₽" : "2 400 ₽ · без изменений"}</strong><span>Будут уведомлены</span><strong>3 игрока + тренер</strong><span>Конфликты</span><strong>Нет</strong><span>Освободится</span><strong>${courts[event.court].name} · ${event.duration} мин</strong></div></section>
    ${priceChanged ? `<section class="attention-card warning"><h3>Правило прайм-тайма</h3><div class="detail-grid"><span>Причина</span><strong>Тариф не покрывает слот</strong><span>Решение</span><strong>Доплата 800 ₽</strong></div></section>` : ""}
    <h3 class="drawer-section-title">Область изменения</h3>
    <div class="radio-stack">
      <label class="radio-card"><input type="radio" name="scope" checked><span><strong>Только это событие</strong><br>Остальная серия не изменится</span></label>
      <label class="radio-card"><input type="radio" name="scope"><span><strong>Это и последующие</strong><br>12 будущих повторений</span></label>
    </div>
  `;
  const actions = `<button class="secondary-button" type="button" data-action="undo">Вернуть</button><button class="confirm" type="button" data-action="confirm-move">Подтвердить перенос</button>`;
  dom.drawer.innerHTML = drawerShell({
    kicker: "ПРЕДПРОСМОТР ПОСЛЕДСТВИЙ · v18",
    title: event.title,
    subtitle: "Изменения ещё не применены · проверено 4 сек. назад",
    body,
    actions,
    type: event.type,
    status: "Ожидает подтверждения",
  });
  bindDrawerActions(event);
}

function openCreateDrawer(court = 4, start = 16) {
  state.selectedId = null;
  state.createDraft = { court, start };
  openDrawer();
  const body = `
    <section class="info-card"><h3>1 · Тип и время</h3><div class="detail-grid"><span>Тип</span><strong>Аренда корта</strong><span>Дата</span><strong>${formatDate(selectedDate(), true)}</strong><span>Время</span><strong>${formatTime(start)}–${formatTime(start + 1)}</strong><span>Ресурс</span><strong>${courts[court].name}</strong></div></section>
    <section class="info-card"><h3>2 · Клиент</h3><div class="person-row"><span class="avatar">＋</span><div><strong>Добавить клиента</strong><small>По телефону, имени или ID</small></div></div></section>
    <section class="info-card"><h3>Расчёт цены</h3><div class="detail-grid"><span>Тариф</span><strong>Непиковый</strong><span>Стоимость</span><strong>2 400 ₽</strong><span>Конфликты</span><strong>Нет</strong></div><div class="status-row"><span class="status-pill good">Слот продаваемый</span><span class="status-pill good">Без пустого окна</span></div></section>
  `;
  const actions = `<button class="secondary-button" type="button" data-action="cancel">Отмена</button><button class="confirm" type="button" data-action="create">Создать аренду</button>`;
  dom.drawer.innerHTML = drawerShell({
    kicker: "НОВОЕ СОБЫТИЕ",
    title: "Быстрое создание",
    subtitle: `${relativeDayLabel()} · ${courts[court].name} · правила проверены`,
    body,
    actions,
    type: "game",
    status: "Черновик",
  });
  bindDrawerActions();
  renderGrid();
}

function bindDrawerActions(event) {
  dom.drawer.querySelector(".drawer-close")?.addEventListener("click", closeDrawer);
  dom.drawer.querySelectorAll(".drawer-tabs button").forEach((button) => {
    button.addEventListener("click", () => showToast(`Открыта вкладка «${button.textContent}»`));
  });
  dom.drawer.querySelectorAll("[data-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const action = button.dataset.action;
      if (action === "toggle-more") {
        const menu = dom.drawer.querySelector(".event-more-menu");
        menu.hidden = !menu.hidden;
      } else if (action === "move" && event) {
        state.moveDraft = { id: event.id, newCourt: Math.min(event.court + 1, courts.length - 1), newStart: Math.min(event.start + 1, END_HOUR - 1) };
        renderMoveDrawer(event, state.moveDraft);
        renderGrid();
      } else if (action === "confirm-move" && event && state.moveDraft) {
        const previous = { court: event.court, start: event.start };
        event.court = state.moveDraft.newCourt;
        event.start = state.moveDraft.newStart;
        state.moveDraft = null;
        closeDrawer();
        showToast(`Событие перенесено на ${formatTime(event.start)}`, "Отменить", () => {
          event.court = previous.court;
          event.start = previous.start;
          renderGrid();
        });
      } else if (action === "refresh") {
        showToast("Данные обновлены до версии Анны Смирновой");
        closeDrawer();
      } else if (action === "resolve") showToast("Конфликт разрешён · Viva получила версию v18");
      else if (action === "offer") showToast("Кандидат переведён в состав");
      else if (action === "create") showToast("Аренда создана · версия v1");
      else if (action === "cancel" || action === "undo") closeDrawer();
      else showToast("Действие выполнено в прототипе");
    });
  });
}

function openDrawer() {
  dom.calendarLayout.classList.add("drawer-open");
}

function closeDrawer() {
  state.selectedId = null;
  state.moveDraft = null;
  dom.calendarLayout.classList.remove("drawer-open");
  renderGrid();
}

function openEvent(id) {
  state.selectedId = id;
  const event = events.find((item) => item.id === id);
  if (!event) return;
  openDrawer();
  renderEventDrawer(event);
  renderGrid();
}

function setMode(mode) {
  state.mode = mode;
  dom.body.dataset.mode = mode;
  document.querySelectorAll(".module-switch button").forEach((button) => {
    button.classList.toggle("active", button.dataset.mode === mode);
  });
  if (mode === "attention") {
    state.selectedId = "e22";
    openDrawer();
    renderAttentionDrawer();
  } else {
    closeDrawer();
  }
  renderKpis();
  renderGrid();
}

function showToast(message, actionLabel, action) {
  dom.toast.innerHTML = `<span>${message}</span>${actionLabel ? `<button type="button">${actionLabel}</button>` : ""}`;
  dom.toast.querySelector("button")?.addEventListener("click", () => {
    action?.();
    dom.toast.classList.remove("show");
  });
  dom.toast.classList.add("show");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => dom.toast.classList.remove("show"), actionLabel ? 6500 : 2800);
}

function renderDate() {
  dom.dateLabel.textContent = formatDate(selectedDate());
  document.getElementById("todayButton").classList.toggle("active", isToday());
  renderTimeAxis();
}

function setDayOffset(offset) {
  state.dayOffset = offset;
  closeDrawer();
  renderDate();
  renderKpis();
  renderGrid();
  showToast(`${relativeDayLabel()}: данные загружены из расписания`);
}

document.querySelectorAll(".module-switch button").forEach((button) => {
  button.addEventListener("click", () => setMode(button.dataset.mode));
});

document.querySelectorAll(".filter-chip[data-filter]").forEach((button) => {
  button.addEventListener("click", () => {
    state.filter = button.dataset.filter;
    document.querySelectorAll(".filter-chip[data-filter]").forEach((chip) => chip.classList.toggle("active", chip === button));
    renderGrid();
  });
});

document.getElementById("filterButton").addEventListener("click", (event) => {
  const expanded = event.currentTarget.getAttribute("aria-expanded") === "true";
  event.currentTarget.setAttribute("aria-expanded", String(!expanded));
  dom.filtersPopover.hidden = expanded;
});
document.getElementById("createEvent").addEventListener("click", () => openCreateDrawer());
document.getElementById("findTime").addEventListener("click", () => {
  dom.calendarScroll.scrollTop = (15.5 - START_HOUR) * state.hourHeight;
  showToast(`${relativeDayLabel()}: 16:00–17:00 · Корт №5 · 2 400 ₽`);
});
document.getElementById("moreButton").addEventListener("click", () => showToast("Ещё: массовый перенос · импорт · печать дня"));
document.getElementById("prevDay").addEventListener("click", () => setDayOffset(state.dayOffset - 1));
document.getElementById("nextDay").addEventListener("click", () => setDayOffset(state.dayOffset + 1));
document.getElementById("todayButton").addEventListener("click", () => setDayOffset(0));
document.getElementById("scaleSelect").addEventListener("change", (event) => {
  state.hourHeight = Number(event.target.value);
  document.documentElement.style.setProperty("--hour-h", `${state.hourHeight}px`);
  renderTimeAxis();
  renderGrid();
});
document.getElementById("focusMode").addEventListener("click", (event) => {
  const focused = dom.body.classList.toggle("focus-mode");
  event.currentTarget.setAttribute("aria-pressed", String(focused));
  event.currentTarget.querySelector("em").textContent = focused ? "Вернуть интерфейс" : "Развернуть расписание";
});
dom.scheduleSearch.addEventListener("input", (event) => {
  state.search = event.target.value.trim();
  renderGrid();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    dom.filtersPopover.hidden = true;
    closeDrawer();
  }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    dom.scheduleSearch.focus();
  }
});

renderHeaders();
renderDate();
renderGrid();
renderKpis();
dom.calendarScroll.scrollTop = (8.7 - START_HOUR) * state.hourHeight;
