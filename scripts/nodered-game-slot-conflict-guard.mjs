const CANCELLED_OR_ARCHIVED = new Set(['CANCELLED', 'CANCELED', 'ARCHIVED']);

function nodeRedPrepareSlotConflictLookup(msg) {
  const isObject = (value) => value && typeof value === 'object' && !Array.isArray(value);
  const toStringOrNull = (value) => {
    if (value === null || value === undefined) return null;
    const normalized = String(value).trim();
    return normalized || null;
  };
  const firstString = (...values) => values.map(toStringOrNull).find(Boolean) || null;
  const parseTime = (date, time, explicitIso) => {
    const iso = toStringOrNull(explicitIso);
    if (iso) return Date.parse(iso);
    if (!date || !time) return Number.NaN;
    const normalizedTime = /^\d{2}:\d{2}$/.test(time) ? `${time}:00` : time;
    return Date.parse(`${date}T${normalizedTime}+03:00`);
  };

  const requestPayload = isObject(msg.payload) ? msg.payload : {};
  const booking = isObject(requestPayload.booking) ? requestPayload.booking : {};
  const payment = isObject(requestPayload.payment) ? requestPayload.payment : {};
  const metadata = isObject(requestPayload.metadata) ? requestPayload.metadata : {};
  const splitPayment = isObject(metadata.splitPayment) ? metadata.splitPayment : {};
  const query = isObject(msg.req?.query) ? msg.req.query : {};
  const requestPath = firstString(msg.req?.path, msg.req?.originalUrl, msg.req?.url) || '';

  const studioId = firstString(booking.studioId, requestPayload.studioId);
  const roomId = firstString(booking.roomId, requestPayload.roomId);
  const date = firstString(booking.date, requestPayload.date, requestPayload.fromDate);
  const timeFrom = firstString(booking.timeFrom, requestPayload.timeFrom, requestPayload.fromTime);
  const timeTo = firstString(booking.timeTo, requestPayload.timeTo, requestPayload.toTime);
  const startTs = parseTime(date, timeFrom, firstString(booking.timeFromIso, requestPayload.timeFromIso));
  const endTs = parseTime(date, timeTo, firstString(booking.timeToIso, requestPayload.timeToIso));

  const gameId = firstString(requestPayload.id, requestPayload.gameId, requestPayload.recordId);
  const paymentRef = firstString(
    requestPayload.paymentRef,
    payment.paymentRef,
    metadata.paymentRef,
    query.paymentRef,
    query.phPaymentRef,
  );
  const vivaExerciseId = firstString(
    booking.vivaExerciseId,
    booking.exerciseId,
    metadata.vivaExerciseId,
    metadata.exerciseId,
    splitPayment.vivaExerciseId,
    splitPayment.exerciseId,
  );
  const paid = payment.paid === true || String(requestPayload.status || '').trim().toUpperCase() === 'PAID';
  const phase = requestPath.toLowerCase().includes('/slot-conflicts/check')
    ? 'pre_payment'
    : (requestPath.toLowerCase().includes('/confirm') || paid ? 'post_payment' : 'before_write');

  if (!studioId || !roomId || !date || !Number.isFinite(startTs) || !Number.isFinite(endTs) || startTs >= endTs) {
    const response = Object.assign({}, msg, {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      payload: {
        error: 'Для проверки занятости нужны корректные станция, корт, дата и интервал',
        code: 'INVALID_GAME_SLOT',
      },
    });
    return [null, response, Object.assign({}, response, {
      payload: { action: 'game_slot_conflict_guard_invalid', requestPath },
    })];
  }

  const idempotencyNor = [];
  if (gameId) {
    idempotencyNor.push({ id: gameId }, { gameId });
  }
  if (paymentRef) {
    idempotencyNor.push(
      { 'payment.paymentRef': paymentRef },
      { 'metadata.paymentRef': paymentRef },
      { 'metadata.splitPayment.paymentRef': paymentRef },
    );
  }
  if (vivaExerciseId) {
    idempotencyNor.push(
      { 'booking.vivaExerciseId': vivaExerciseId },
      { 'booking.exerciseId': vivaExerciseId },
      { 'metadata.vivaExerciseId': vivaExerciseId },
      { 'metadata.exerciseId': vivaExerciseId },
    );
  }

  const inactiveStatus = /^(?:CANCELLED|CANCELED|ARCHIVED)$/i;
  const norConditions = [
    { status: { $regex: inactiveStatus } },
    { rawStatus: { $regex: inactiveStatus } },
    { 'metadata.status': { $regex: inactiveStatus } },
    { 'metadata.rawStatus': { $regex: inactiveStatus } },
    { 'metadata.gameStatus': { $regex: inactiveStatus } },
    { 'metadata.isCancelled': true },
    { 'booking.isCancelled': true },
    ...idempotencyNor,
  ];

  const slot = {
    studioId,
    roomId,
    date,
    timeFrom,
    timeTo,
    startTs,
    endTs,
    gameId,
    paymentRef,
    vivaExerciseId,
  };
  msg._slotConflictGuard = {
    phase,
    requestPath,
    requestPayload,
    slot,
  };
  msg.payload = {
    archived: { $ne: true },
    'booking.studioId': studioId,
    'booking.roomId': roomId,
    'booking.date': date,
    'booking.startTs': { $lt: endTs },
    'booking.endTs': { $gt: startTs },
    $nor: norConditions,
  };

  const debug = Object.assign({}, msg, {
    payload: {
      action: 'game_slot_conflict_lookup',
      phase,
      slot,
      query: msg.payload,
    },
  });
  return [msg, null, debug];
}

function nodeRedResolveSlotConflictLookup(msg) {
  const isObject = (value) => value && typeof value === 'object' && !Array.isArray(value);
  const toStringOrNull = (value) => {
    if (value === null || value === undefined) return null;
    const normalized = String(value).trim();
    return normalized || null;
  };
  const firstString = (...values) => values.map(toStringOrNull).find(Boolean) || null;
  const inactiveStatuses = new Set(['CANCELLED', 'CANCELED', 'ARCHIVED']);
  const statusesOf = (record) => [
    record?.status,
    record?.rawStatus,
    record?.metadata?.status,
    record?.metadata?.rawStatus,
    record?.metadata?.gameStatus,
  ].map(toStringOrNull).filter(Boolean);
  const statusOf = (record) => statusesOf(record)[0] || null;
  const isInactive = (record) => (
    record?.archived === true
    || record?.metadata?.isCancelled === true
    || record?.booking?.isCancelled === true
    || statusesOf(record).some((status) => inactiveStatuses.has(status.toUpperCase()))
  );
  const identity = (record) => ({
    gameId: firstString(record?.id, record?.gameId),
    paymentRef: firstString(
      record?.payment?.paymentRef,
      record?.metadata?.paymentRef,
      record?.metadata?.splitPayment?.paymentRef,
    ),
    vivaExerciseId: firstString(
      record?.booking?.vivaExerciseId,
      record?.booking?.exerciseId,
      record?.metadata?.vivaExerciseId,
      record?.metadata?.exerciseId,
    ),
  });
  const sameNonEmptyValue = (left, right) => Boolean(left && right && left === right);
  const isSameOperation = (record, slot) => {
    const existing = identity(record);
    return sameNonEmptyValue(existing.gameId, slot.gameId)
      || sameNonEmptyValue(existing.paymentRef, slot.paymentRef)
      || sameNonEmptyValue(existing.vivaExerciseId, slot.vivaExerciseId);
  };
  const isOverlappingSlot = (record, slot) => {
    const booking = isObject(record?.booking) ? record.booking : {};
    const startTs = Number(booking.startTs);
    const endTs = Number(booking.endTs);
    return String(booking.studioId || '') === slot.studioId
      && String(booking.roomId || '') === slot.roomId
      && String(booking.date || '') === slot.date
      && Number.isFinite(startTs)
      && Number.isFinite(endTs)
      && startTs < slot.endTs
      && endTs > slot.startTs;
  };

  const context = isObject(msg._slotConflictGuard) ? msg._slotConflictGuard : null;
  if (!context || !isObject(context.slot) || !isObject(context.requestPayload)) {
    const response = Object.assign({}, msg, {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      payload: { error: 'Контекст проверки слота потерян', code: 'GAME_SLOT_GUARD_CONTEXT_MISSING' },
    });
    return [null, response, Object.assign({}, response, {
      payload: { action: 'game_slot_conflict_guard_context_missing' },
    })];
  }

  const rows = Array.isArray(msg.payload) ? msg.payload : (isObject(msg.payload) ? [msg.payload] : []);
  const conflict = rows.find((record) => (
    isObject(record)
    && !isInactive(record)
    && !isSameOperation(record, context.slot)
    && isOverlappingSlot(record, context.slot)
  )) || null;

  if (!conflict) {
    if (context.phase === 'pre_payment') {
      const response = Object.assign({}, msg, {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        payload: { ok: true, available: true, slot: context.slot },
      });
      return [null, response, Object.assign({}, response, {
        payload: { action: 'game_slot_available', slot: context.slot },
      })];
    }
    msg.payload = context.requestPayload;
    return [msg, null, Object.assign({}, msg, {
      payload: { action: 'game_slot_write_allowed', phase: context.phase, slot: context.slot },
    })];
  }

  const conflictIdentity = identity(conflict);
  const conflictSummary = {
    id: conflictIdentity.gameId,
    paymentRef: conflictIdentity.paymentRef,
    vivaExerciseId: conflictIdentity.vivaExerciseId,
    status: statusOf(conflict),
    date: firstString(conflict?.booking?.date),
    timeFrom: firstString(conflict?.booking?.timeFrom),
    timeTo: firstString(conflict?.booking?.timeTo),
  };

  if (context.phase === 'post_payment') {
    const original = context.requestPayload;
    const originalMetadata = isObject(original.metadata) ? original.metadata : {};
    const reviewAt = new Date().toISOString();
    msg.payload = Object.assign({}, original, {
      status: 'CONFLICT_REVIEW',
      metadata: Object.assign({}, originalMetadata, {
        slotConflictReview: {
          state: 'OPEN',
          detectedAt: reviewAt,
          code: 'GAME_SLOT_CONFLICT_AFTER_PAYMENT',
          requestedSlot: context.slot,
          conflict: conflictSummary,
        },
      }),
    });
    msg._slotConflictReview = msg.payload.metadata.slotConflictReview;
    return [msg, null, Object.assign({}, msg, {
      payload: {
        action: 'game_slot_conflict_review_opened',
        code: 'GAME_SLOT_CONFLICT_AFTER_PAYMENT',
        requestedSlot: context.slot,
        conflict: conflictSummary,
      },
    })];
  }

  const response = Object.assign({}, msg, {
    statusCode: 409,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    payload: {
      error: 'Выбранный корт уже занят в это время',
      code: 'GAME_SLOT_CONFLICT',
      conflict: conflictSummary,
    },
  });
  return [null, response, Object.assign({}, response, {
    payload: {
      action: 'game_slot_conflict_blocked',
      code: 'GAME_SLOT_CONFLICT',
      phase: context.phase,
      requestedSlot: context.slot,
      conflict: conflictSummary,
    },
  })];
}

export function prepareSlotConflictLookup(msg) {
  return nodeRedPrepareSlotConflictLookup(msg);
}

export function resolveSlotConflictLookup(msg) {
  return nodeRedResolveSlotConflictLookup(msg);
}

export const PREPARE_SLOT_CONFLICT_FUNCTION_SOURCE =
  `return (${nodeRedPrepareSlotConflictLookup.toString()})(msg);`;

export const RESOLVE_SLOT_CONFLICT_FUNCTION_SOURCE =
  `return (${nodeRedResolveSlotConflictLookup.toString()})(msg);`;

export function isCancelledOrArchivedStatus(status) {
  return CANCELLED_OR_ARCHIVED.has(String(status || '').trim().toUpperCase());
}
