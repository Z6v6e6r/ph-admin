import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
const sdk = fs.readFileSync(new URL('../client-sdk/phab-admin-panel.js', import.meta.url), 'utf8');
function load(name, context) {
  const start = sdk.indexOf(`    function ${name}(`); assert(start >= 0);
  const rest = sdk.slice(start + 1), next = rest.search(/^    (?:async )?function /m);
  return vm.runInNewContext(sdk.slice(start, next < 0 ? sdk.length : start + 1 + next) + `\n${name}`, context);
}
test('same message with renewed photo URL invalidates rendered signature', () => {
  const signature = load('buildMessagesSignature', { normalizeMessageAttachments: a => a || [] });
  const message = { id: 'synthetic-message', attachments: [{ id: 'photo', url: 'https://synthetic.invalid/first' }] };
  assert.notEqual(signature([message]), signature([{ ...message, attachments: [{ ...message.attachments[0], url: 'https://synthetic.invalid/renewed' }] }]));
});
test('preview/download refresh performs a history read for the exact message/photo without repeating a send', async () => {
  let reads = 0;
  const refresh = load('refreshPhotoAttachment', { URL, Promise, normalizeMessageAttachments: x => x || [],
    shouldIncludeServiceMessages: () => false, fetchDialogMessages: async (id, options) => {
      reads++; assert.equal(id, 'synthetic-dialog'); assert.equal(options.forceRefresh, true);
      return [{ id: 'foreign-message', attachments: [{ id: 'same-id', url: 'https://synthetic.invalid/foreign' }] },
        { id: 'selected-message', attachments: [{ id: 'same-id', url: 'https://synthetic.invalid/renewed' }] }];
    } });
  const fresh = await refresh({ id: 'same-id', url: 'https://synthetic.invalid/expired?X-Amz-Signature=synthetic' }, 'synthetic-dialog', 'selected-message');
  assert.equal(fresh.url, 'https://synthetic.invalid/renewed'); assert.equal(reads, 1);
  await assert.rejects(refresh({ id: 'missing', url: 'https://synthetic.invalid/expired?X-Amz-Signature=synthetic' }, 'synthetic-dialog', 'selected-message'));
});
