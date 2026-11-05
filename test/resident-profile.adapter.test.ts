import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { VivaAdminService } from '../src/integrations/viva/viva-admin.service';
import {
  SubscriptionsVivaResidentProfileAdapter,
  normalizeResidentPhotoUrl
} from '../src/residency-check/resident-profile.adapter';

function adapterWith(input: {
  instance?: Record<string, unknown> | null;
  profile?: Record<string, unknown> | null;
  throws?: boolean;
}): SubscriptionsVivaResidentProfileAdapter {
  const subscriptions = {
    runtimeInstanceById: async () => {
      if (input.throws) throw new Error('mongo down');
      return input.instance === undefined
        ? { providerClientId: 'viva-client-1' }
        : input.instance;
    }
  } as any;
  const viva = {
    getClientProfile: async () => input.profile ?? null
  } as any;
  return new SubscriptionsVivaResidentProfileAdapter(subscriptions, viva);
}

async function main(): Promise<void> {
  // Photo URL policy: only https or site-relative single-slash paths.
  assert.equal(normalizeResidentPhotoUrl('https://cdn.example/a.jpg'), 'https://cdn.example/a.jpg');
  assert.equal(normalizeResidentPhotoUrl(' /media/a.jpg '), '/media/a.jpg');
  assert.equal(normalizeResidentPhotoUrl('http://cdn.example/a.jpg'), null);
  assert.equal(normalizeResidentPhotoUrl('//cdn.example/a.jpg'), null);
  assert.equal(normalizeResidentPhotoUrl('javascript:alert(1)'), null);
  assert.equal(normalizeResidentPhotoUrl('data:image/png;base64,AAAA'), null);
  assert.equal(normalizeResidentPhotoUrl('https://user:pass@cdn.example/a.jpg'), null);
  assert.equal(normalizeResidentPhotoUrl(null), null);
  assert.equal(normalizeResidentPhotoUrl(42), null);

  const mapped = await adapterWith({
    profile: { displayName: '  Анна Резидентова  ', avatarUrl: 'https://cdn.example/a.jpg' }
  }).profileBySubscriptionInstance('instance-1');
  assert.deepEqual(mapped, {
    displayName: 'Анна Резидентова',
    avatarUrl: 'https://cdn.example/a.jpg'
  });

  const relativePhoto = await adapterWith({
    profile: { displayName: 'Имя', avatarUrl: '/media/b.jpg' }
  }).profileBySubscriptionInstance('instance-1');
  assert.deepEqual(relativePhoto, { displayName: 'Имя', avatarUrl: '/media/b.jpg' });

  const noName = await adapterWith({ profile: { avatarUrl: null } })
    .profileBySubscriptionInstance('instance-1');
  assert.deepEqual(noName, { avatarUrl: null });

  const missingInstance = await adapterWith({ instance: null })
    .profileBySubscriptionInstance('instance-1');
  assert.equal(missingInstance, null);

  const missingProfile = await adapterWith({ profile: null })
    .profileBySubscriptionInstance('instance-1');
  assert.equal(missingProfile, null);

  const storageFailure = await adapterWith({ throws: true })
    .profileBySubscriptionInstance('instance-1');
  assert.equal(storageFailure, null);

  const emptyId = await adapterWith({})
    .profileBySubscriptionInstance('   ');
  assert.equal(emptyId, null);

  // The Viva read method uses the existing admin credential and extracts the
  // display fields from the existing client read route without provider ids.
  const service = new VivaAdminService();
  (service as any).requireAccessToken = async () => 'admin-token';
  (service as any).getResolvedSettings = async () => ({
    config: { baseUrl: 'https://viva.example' }
  });
  let seenPath = '';
  (service as any).fetchAdminJson = async (path: string) => {
    seenPath = path;
    return { id: 'viva-client-1', name: 'Анна Резидентова', photo: 'https://cdn.example/a.jpg', phone: '+79990000000' };
  };
  const profile = await service.getClientProfile('viva-client-1');
  assert.deepEqual(profile, {
    clientId: 'viva-client-1',
    displayName: 'Анна Резидентова',
    avatarUrl: 'https://cdn.example/a.jpg',
    phone: '79990000000'
  });
  assert.equal(seenPath, '/api/v1/clients/viva-client-1');

  const empty = await service.getClientProfile('   ');
  assert.equal(empty, null);

  console.log('Resident profile adapter test passed');
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
