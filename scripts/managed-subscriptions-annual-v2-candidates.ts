#!/usr/bin/env node
import {
  buildManagedAnnualSubscriptionV2Candidate,
  ManagedAnnualSubscriptionScope
} from '../src/subscriptions/annual-subscription-policy-v2-candidate';

const renderArg = process.argv.find((item) => item.startsWith('--render='));
const check = process.argv.includes('--check');

if ((check ? 1 : 0) + (renderArg ? 1 : 0) !== 1) {
  process.stderr.write('Use exactly one of --check or --render=PITER|HUB\n');
  process.exitCode = 2;
} else if (renderArg) {
  const scope = renderArg.slice('--render='.length).toUpperCase();
  if (!['PITER', 'HUB'].includes(scope)) {
    process.stderr.write('Scope must be PITER or HUB\n');
    process.exitCode = 2;
  } else {
    process.stdout.write(`${JSON.stringify(
      buildManagedAnnualSubscriptionV2Candidate(scope as ManagedAnnualSubscriptionScope),
      null,
      2
    )}\n`);
  }
} else {
  const candidates = (['PITER', 'HUB'] as const).map((scope) => {
    const candidate = buildManagedAnnualSubscriptionV2Candidate(scope);
    return {
      scope,
      subscriptionTypeId: candidate.subscriptionTypeId,
      expectedPreviousVersion: candidate.expectedPreviousVersion,
      expectedNextVersion: candidate.expectedNextVersion,
      providerProductId: candidate.providerEvidence.providerProductId,
      benefitStationCount: candidate.request.benefitRules[0].stationIds.length,
      externalEventTypeId: candidate.request.benefitRules[0].externalEventTypeIds[0],
      dictionaryRevision: candidate.dictionaryRevision,
      publicationBlockers: candidate.publicationBlockers,
      mutationPerformed: false
    };
  });
  process.stdout.write(`${JSON.stringify({ mode: 'check', candidates }, null, 2)}\n`);
}
