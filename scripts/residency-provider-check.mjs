// Operator read-only acceptance. This command never creates a bearer, observation or payment.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';
// Run from the pinned immutable release, even when this reviewed operator script is staged elsewhere.
const manifest = JSON.parse(readFileSync(path.join(process.cwd(), 'runtime-manifest.json'), 'utf8'));
if (!/^[a-f0-9]{40}$/.test(process.env.CUP_RESIDENCY_EXPECTED_SOURCE_COMMIT || '')
  || manifest.sourceCommit !== process.env.CUP_RESIDENCY_EXPECTED_SOURCE_COMMIT) throw Error('RESIDENCY_CHECK_SOURCE_INVALID');
const require = createRequire(path.join(process.cwd(), 'package.json'));
require('reflect-metadata');
const { VivaAdminService } = require('./dist/integrations/viva/viva-admin.service.js');
const { ResidencyObservationRepository } = require('./dist/subscriptions/residency-observation.repository.js');
const { normalizeResidencyProviderFacts, residencyDigest } = require('./dist/subscriptions/residency-provider-observation.js');
const { resolveSubscriptionSalePeriod } = require('./dist/subscriptions/subscription-sale-period-resolver.js');
const { residencyBookingPolicyBlockers } = require('./dist/subscriptions/residency-booking-policy.js');

const args = process.argv.slice(2);
const viva = new VivaAdminService(), repository = new ResidencyObservationRepository();
try {
  if (process.env.NODE_ENV !== 'production' || args.length !== 5 || args[0] !== '--check'
    || args[1] !== '--client-id' || args[3] !== '--subscription-id'
    || !/^[A-Za-z0-9][A-Za-z0-9._:-]{2,199}$/.test(args[2])
    || !/^[A-Za-z0-9][A-Za-z0-9._:-]{2,199}$/.test(args[4])
    || args[2] !== process.env.SUBSCRIPTIONS_RESIDENCY_READ_APPROVED_CLIENT_ID) throw Error('RESIDENCY_CHECK_TARGET_INVALID');
  // Production Viva module initialization verifies existing indexes; it does not auto-create them.
  await viva.onModuleInit();
  const snapshot = await repository.binding(process.env.SUBSCRIPTIONS_RUNTIME_TENANT_ID);
  const source = await viva.readResidencySubscriptionEvidence({ clientId: args[2], clientSubscriptionId: args[4],
    studioId: process.env.SUBSCRIPTIONS_RESIDENCY_SYNC_STUDIO_ID, deadline: Date.now() + 8000 });
  const facts = normalizeResidencyProviderFacts({ providerClientId: args[2], clientSubscriptionId: args[4],
    subscription: source.subscription, transaction: source.transaction, observedAt: new Date().toISOString() });
  const selected = resolveSubscriptionSalePeriod({ purchasedAt: facts.purchasedAt, publications: snapshot.publications });
  if (selected.kind !== 'MATCH' || residencyBookingPolicyBlockers(selected.publication.runtimeProjection).length) {
    throw Error('RESIDENCY_CHECK_POLICY_UNSUPPORTED');
  }
  console.log(JSON.stringify({ mode: 'PROVIDER_READ_ONLY', write: false,
    identityDigest: residencyDigest({ clientId: args[2], clientSubscriptionId: args[4] }),
    eligible: facts.eligible, denialReason: facts.denialReason, providerStatus: facts.providerStatus,
    windowOrigin: facts.windowOrigin, rawProviderPurchaseDate: facts.providerPurchaseDateRaw,
    rawProviderActivationDate: facts.providerActivationDateRaw, rawProviderExpirationDate: facts.providerExpirationDateRaw,
    paymentStatus: facts.paymentStatus, purchasedAt: facts.purchasedAt, activeFrom: facts.activeFrom, activeTo: facts.activeTo,
    purchaseAmountMinor: facts.purchaseAmountMinor, sourceDigest: facts.sourceDigest,
    publicationId: selected.publication.publicationId, policyDigest: selected.publication.policyDigest,
    instanceObservedAt: source.instanceObservedAt, productObservedAt: source.productObservedAt }));
} catch (error) {
  const candidate = error?.getResponse?.()?.code || error?.message;
  console.error(JSON.stringify({ mode: 'PROVIDER_READ_ONLY', write: false,
    errorCode: /^RESIDENCY_[A-Z_]+$/.test(candidate || '') ? candidate : 'RESIDENCY_CHECK_FAILED' }));
  process.exitCode = 1;
} finally { await repository.onModuleDestroy(); await viva.onModuleDestroy(); }
