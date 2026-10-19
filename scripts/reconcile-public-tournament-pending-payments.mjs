#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { MongoClient } from 'mongodb';

const ACTIVE_STATES = new Set([
  'PROVIDER_CREATE_PENDING',
  'PROVIDER_RESULT_UNKNOWN',
  'PENDING_PAYMENT',
  'BOOKING_CREATION_IN_PROGRESS',
  'PAID_PENDING_FINALIZATION'
]);
const REPORTABLE_STATES = new Set([...ACTIVE_STATES, 'EXPIRED', 'FAILED']);
export const LEGACY_REQUIRED_RESOLUTION =
  'PAID_BOUND or leave unresolved; UNPAID is not terminal';

export function isProviderUnresolvedAttempt(value) {
  return Boolean(
    value
    && typeof value === 'object'
    && !Array.isArray(value)
    && typeof value.transactionId === 'string'
    && typeof value.phone === 'string'
    && value.operationType === 'TRANSACTION'
    && ['PROVIDER_CREATE_PENDING', 'PROVIDER_RESULT_UNKNOWN'].includes(value.state)
  );
}

export function isLegacyPendingPayment(value) {
  return Boolean(
    value
    && typeof value === 'object'
    && !Array.isArray(value)
    && typeof value.transactionId === 'string'
    && typeof value.phone === 'string'
    && !ACTIVE_STATES.has(value.state)
    && value.state !== 'EXPIRED'
    && value.state !== 'FAILED'
  );
}

export function pendingFingerprint(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function assertString(value, field) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} is required`);
  return value.trim();
}

export function validateDecision(decision) {
  if (!decision || typeof decision !== 'object' || Array.isArray(decision)) {
    throw new Error('decision must be an object');
  }
  const tournamentId = assertString(decision.tournamentId, 'tournamentId');
  const transactionId = assertString(decision.transactionId, 'transactionId');
  const phone = assertString(decision.phone, 'phone');
  const currentState = decision.currentState === undefined
    ? undefined
    : assertString(decision.currentState, 'currentState');
  if (currentState !== undefined && currentState !== 'PROVIDER_RESULT_UNKNOWN') {
    throw new Error('currentState must be PROVIDER_RESULT_UNKNOWN when present');
  }
  const providerTransactionId = currentState === 'PROVIDER_RESULT_UNKNOWN'
    ? assertString(decision.providerTransactionId, 'providerTransactionId')
    : undefined;
  const expectedFingerprint = assertString(decision.expectedFingerprint, 'expectedFingerprint');
  if (!/^[0-9a-f]{64}$/.test(expectedFingerprint)) {
    throw new Error('expectedFingerprint must be sha256 hex');
  }
  const verifiedAt = assertString(decision.verifiedAt, 'verifiedAt');
  if (!Number.isFinite(Date.parse(verifiedAt))) throw new Error('verifiedAt must be ISO datetime');
  if (decision.resolution !== 'PAID_BOUND' && decision.resolution !== 'PROVIDER_BOUND') {
    throw new Error('resolution must be PROVIDER_BOUND or PAID_BOUND');
  }
  const replacement = decision.replacement;
  if (!replacement || typeof replacement !== 'object' || Array.isArray(replacement)) {
    throw new Error('PAID_BOUND replacement is required');
  }
  const snapshot = replacement.eligibilitySnapshot;
  const baseExact = (
    replacement.transactionId === transactionId
    && replacement.phone === phone
    && replacement.operationType === 'TRANSACTION'
    && (providerTransactionId === undefined
      ? replacement.providerTransactionId === undefined
      : replacement.providerTransactionId === providerTransactionId)
    && typeof replacement.exerciseId === 'string'
    && Boolean(replacement.exerciseId.trim())
    && typeof replacement.studioId === 'string'
    && Boolean(replacement.studioId.trim())
    && typeof replacement.widgetId === 'string'
    && Boolean(replacement.widgetId.trim())
    && typeof replacement.selectedPurchaseOptionId === 'string'
    && Boolean(replacement.selectedPurchaseOptionId.trim())
    && ['SERVICE', 'SUBSCRIPTION'].includes(replacement.productType)
    && Number.isSafeInteger(replacement.amountMinor)
    && replacement.amountMinor >= 0
    && replacement.currency === 'RUB'
    && snapshot?.activityType === 'TOURNAMENT'
    && snapshot.activityId === tournamentId
    && snapshot.playerId === phone
    && (snapshot.result === 'ALLOWED' || snapshot.result === 'WARNING')
    && typeof snapshot.decisionId === 'string'
    && Boolean(snapshot.decisionId.trim())
    && typeof snapshot.evaluatedAt === 'string'
    && Number.isFinite(Date.parse(snapshot.evaluatedAt))
  );
  if (decision.resolution === 'PROVIDER_BOUND') {
    const exact = baseExact
      && currentState === 'PROVIDER_RESULT_UNKNOWN'
      && replacement.state === 'PENDING_PAYMENT'
      && typeof replacement.checkoutUrl === 'string'
      && /^https?:\/\//i.test(replacement.checkoutUrl)
      && typeof replacement.paymentExpiresAt === 'string'
      && Number.isFinite(Date.parse(replacement.paymentExpiresAt))
      && Date.parse(replacement.paymentExpiresAt) > Date.now();
    if (!exact) throw new Error('PROVIDER_BOUND replacement is not fully provider/activity bound');
    return {
      tournamentId,
      transactionId,
      phone,
      expectedFingerprint,
      currentState,
      providerTransactionId,
      replacement
    };
  }
  const evidence = replacement.verifiedPayment;
  const exact = baseExact
    && replacement.state === 'PAID_PENDING_FINALIZATION'
    && evidence?.provider === 'VIVA'
    && evidence.operationType === 'TRANSACTION'
    && evidence.operationId === (providerTransactionId ?? transactionId)
    && evidence.status === 'PAID'
    && evidence.exerciseId === replacement.exerciseId
    && evidence.phone === phone
    && evidence.amountMinor === replacement.amountMinor
    && evidence.currency === 'RUB'
    && Number.isFinite(Date.parse(evidence.verifiedAt));
  if (!exact) throw new Error('PAID_BOUND replacement is not fully provider/activity bound');
  return {
    tournamentId,
    transactionId,
    phone,
    expectedFingerprint,
    currentState,
    providerTransactionId,
    replacement
  };
}

export function buildDecisionElementMatch(decision) {
  return {
    transactionId: decision.transactionId,
    phone: decision.phone,
    ...(decision.currentState === 'PROVIDER_RESULT_UNKNOWN'
      ? {
          state: 'PROVIDER_RESULT_UNKNOWN',
          providerTransactionId: decision.providerTransactionId
        }
      : { state: { $exists: false } })
  };
}

export function buildDecisionArrayFilter(decision) {
  const match = buildDecisionElementMatch(decision);
  return Object.fromEntries(
    Object.entries(match).map(([key, value]) => [`payment.${key}`, value])
  );
}

function maskPhone(phone) {
  return phone.length > 4 ? `${'*'.repeat(phone.length - 4)}${phone.slice(-4)}` : '****';
}

export function buildPendingReport(documents, target) {
  const rows = [];
  for (const document of documents) {
    const pending = document?.details?.booking?.pendingJoinPayments;
    if (pending === undefined) continue;
    if (!Array.isArray(pending)) {
      rows.push({ tournamentId: String(document.id ?? document._id),
        reasonCode: 'MALFORMED_PENDING_ARRAY',
        requiredResolution: 'MANUAL_DATA_REVIEW; NO AUTOMATIC RETRY OR RELEASE' });
      continue;
    }
    for (const payment of pending) {
      const record = payment && typeof payment === 'object' && !Array.isArray(payment) ? payment : null;
      const row = {
        tournamentId: String(document.id ?? document._id),
        attemptIdHash: typeof record?.transactionId === 'string'
          ? pendingFingerprint(record.transactionId).slice(0, 16) : null,
        providerTransactionIdHash: typeof record?.providerTransactionId === 'string'
          ? pendingFingerprint(record.providerTransactionId).slice(0, 16) : null,
        phoneMasked: maskPhone(String(record?.phone ?? '')),
        state: typeof record?.state === 'string' && REPORTABLE_STATES.has(record.state) ? record.state : null,
        expectedFingerprint: pendingFingerprint(payment ?? null),
        reasonCode: 'PENDING_RECORD_REQUIRES_REVIEW',
        requiredResolution: 'MANUAL_BINDING_REVIEW; NO AUTOMATIC RETRY OR RELEASE'
      };
      if (!record || typeof record.transactionId !== 'string' || typeof record.phone !== 'string') {
        row.reasonCode = 'MALFORMED_PENDING_RECORD';
      } else if (isProviderUnresolvedAttempt(record)) {
        row.reasonCode = 'PROVIDER_ATTEMPT_UNRESOLVED';
        row.requiredResolution = record.state === 'PROVIDER_CREATE_PENDING'
          ? 'CONTINUE ONLY THE ORIGINAL DURABLE CLAIM PATH; NO MANUAL POST'
          : 'AUTHORITATIVE_PROVIDER_RECONCILIATION; NO BLIND POST RETRY';
      } else if (record.state === 'PENDING_PAYMENT') {
        const bound = record.operationType === 'TRANSACTION' &&
          ['exerciseId', 'studioId', 'widgetId', 'selectedPurchaseOptionId', 'checkoutUrl', 'currency']
            .every(key => typeof record[key] === 'string' && record[key].trim()) &&
          Number.isSafeInteger(record.amountMinor) && record.amountMinor >= 0 &&
          record.eligibilitySnapshot?.activityId === String(document.id);
        row.reasonCode = bound ? 'ACTIVE_PAYMENT_REQUIRES_REVIEW' : 'ACTIVE_PAYMENT_BINDING_INCOMPLETE';
      } else if (isLegacyPendingPayment(record)) {
        row.reasonCode = 'LEGACY_PAYMENT_UNBOUND';
        row.requiredResolution = LEGACY_REQUIRED_RESOLUTION;
      }
      rows.push(row);
    }
  }
  // Even a completely empty report is not an index, durability or deployment attestation.
  return { mode: 'DRY_RUN', target, count: rows.length, readyForDeployment: false, rows };
}

export async function applyReconciliationDecision(collection, input) {
  const decision = validateDecision(input);
  const elementMatch = buildDecisionElementMatch(decision);
  const document = await collection.findOne({
    id: decision.tournamentId,
    'details.booking.pendingJoinPayments': { $elemMatch: elementMatch }
  });
  const pending = document?.details?.booking?.pendingJoinPayments;
  const matches = Array.isArray(pending) ? pending.filter((payment) => (
    payment?.transactionId === decision.transactionId && payment?.phone === decision.phone &&
    (decision.currentState === 'PROVIDER_RESULT_UNKNOWN'
      ? payment?.state === 'PROVIDER_RESULT_UNKNOWN' && payment?.providerTransactionId === decision.providerTransactionId
      : payment?.state === undefined)
  )) : [];
  if (matches.length > 1) throw new Error(`CAS precheck ambiguous for tournament ${decision.tournamentId}`);
  const current = matches[0];
  if (!current || pendingFingerprint(current) !== decision.expectedFingerprint) {
    throw new Error(`CAS precheck failed for tournament ${decision.tournamentId}`);
  }
  const result = await collection.updateOne({
    _id: document._id,
    id: decision.tournamentId,
    // Full-array preimage also fences insertion/removal/reordering of sibling attempts.
    'details.booking.pendingJoinPayments': { $eq: pending }
  }, { $set: {
    [`details.booking.pendingJoinPayments.${pending.indexOf(current)}`]: decision.replacement,
    updatedAt: new Date().toISOString()
  } });
  if (result.modifiedCount !== 1) {
    throw new Error(`CAS update failed for tournament ${decision.tournamentId}`);
  }
  return { tournamentId: decision.tournamentId, ok: true };
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const decisionsIndex = args.indexOf('--decisions');
  const decisionsPath = decisionsIndex >= 0 ? args[decisionsIndex + 1] : null;
  if (apply && !decisionsPath) throw new Error('--apply requires --decisions /absolute/file.json');
  const mongoUri = process.env.TOURNAMENTS_MONGODB_URI ?? process.env.MONGODB_URI;
  const databaseName = String(process.env.TOURNAMENTS_MONGODB_DB ?? '').trim();
  const collectionName = process.env.TOURNAMENTS_MONGODB_COLLECTION ?? 'custom_tournaments';
  if (!mongoUri) throw new Error('TOURNAMENTS_MONGODB_URI or MONGODB_URI is required');
  if (!databaseName) throw new Error('TOURNAMENTS_MONGODB_DB must be explicitly configured');

  const client = new MongoClient(mongoUri, { serverSelectionTimeoutMS: 5000 });
  await client.connect();
  try {
    const collection = client.db(databaseName).collection(collectionName);
    if (!apply) {
      const documents = await collection.find({
        'details.booking.pendingJoinPayments': { $exists: true, $ne: [] }
      }).toArray();
      const report = buildPendingReport(documents, { databaseName, collectionName });
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      return;
    }

    const raw = JSON.parse(await readFile(decisionsPath, 'utf8'));
    if (!Array.isArray(raw)) throw new Error('decisions file must contain a JSON array');
    // Validate the entire plan before the first write, then revalidate at each apply.
    const decisions = raw.map(input => { validateDecision(input); return input; });
    const results = [];
    for (const decision of decisions) {
      results.push(await applyReconciliationDecision(collection, decision));
    }
    process.stdout.write(`${JSON.stringify({ mode: 'APPLY', count: results.length, results })}\n`);
  } finally {
    await client.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
