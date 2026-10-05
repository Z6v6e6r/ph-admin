import { createHash } from 'node:crypto';
import {
  StoredSubscriptionPolicyPublication,
  StoredSubscriptionProjectionFence,
  StoredSubscriptionProviderMapping,
  SubscriptionProjectionFenceBinding
} from './subscriptions.types';

const stableValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value as Record<string, unknown>).sort()
    .map((key) => [key, stableValue((value as Record<string, unknown>)[key])]));
};

const sha256 = (value: unknown): `sha256:${string}` => `sha256:${createHash('sha256')
  .update(JSON.stringify(stableValue(value)))
  .digest('hex')}`;

export function subscriptionProjectionFenceId(subscriptionTypeId: string): string {
  return `subscription_projection_fence:${createHash('sha256')
    .update(`subscription-projection-fence:v1\0${subscriptionTypeId}`)
    .digest('hex')}`;
}

export function subscriptionProjectionFenceBinding(
  mapping: StoredSubscriptionProviderMapping,
  publication: StoredSubscriptionPolicyPublication
): SubscriptionProjectionFenceBinding {
  if (!publication.runtimeCompatibility) {
    throw new Error('SUBSCRIPTION_PROJECTION_FENCE_COMPATIBILITY_REQUIRED');
  }
  return {
    mappingId: mapping.mappingId,
    mappingRevision: mapping.revision,
    subscriptionTypeId: publication.subscriptionTypeId,
    publicationId: publication.publicationId,
    policyVersion: publication.policyVersion,
    policyDigest: publication.policyDigest as `sha256:${string}`,
    runtimeCompatibility: publication.runtimeCompatibility
  };
}

export function subscriptionProjectionFenceBindingDigest(
  binding: SubscriptionProjectionFenceBinding
): `sha256:${string}` {
  return sha256(binding);
}

export function buildSubscriptionProjectionFence(input: {
  mapping: StoredSubscriptionProviderMapping;
  publication: StoredSubscriptionPolicyPublication;
  previous: StoredSubscriptionProjectionFence | null;
}): StoredSubscriptionProjectionFence {
  const binding = subscriptionProjectionFenceBinding(input.mapping, input.publication);
  const now = input.publication.publishedAt;
  return {
    schemaVersion: 1,
    fenceId: subscriptionProjectionFenceId(binding.subscriptionTypeId),
    subscriptionTypeId: binding.subscriptionTypeId,
    bindingRevision: (input.previous?.bindingRevision ?? 0) + 1,
    bindingDigest: subscriptionProjectionFenceBindingDigest(binding),
    binding,
    coordinationRevision: (input.previous?.coordinationRevision ?? 0) + 1,
    lastProjectorReconciliationDigest: null,
    createdAt: input.previous?.createdAt ?? now,
    updatedAt: now
  };
}
