import { strict as assert } from 'assert';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * The CUP notification composer may address recipients by phone number and/or by PadlHub user id.
 * The panel is a browser asset without a unit-test runtime, so this guards the served contract: the
 * request payloads carry a selector object, the new field is really wired into the shared DOM map and
 * listeners, a malformed id or an over-limit selection blocks sending instead of being dropped
 * silently, and a stale resolution cannot arm the send button.
 */
async function main(): Promise<void> {
  const panel = readFileSync(resolve(__dirname, '../client-sdk/phab-admin-panel.js'), 'utf8');

  // Payload contract.
  assert.match(
    panel,
    /resolveRecipients: function \(selector\) \{[\s\S]{0,220}?'POST',\s*\n\s*selector,/,
    'recipient resolution must forward the whole selector, not a phone-only payload'
  );
  assert.match(
    panel,
    /Object\.assign\(\{\}, notificationRecipientSelection\(\)\.selector, \{/,
    'the campaign payload must be built from the recipient selector'
  );

  // The field, its warning node, the DOM map and the listeners are one wiring unit: dropping any of
  // them throws while binding events, which takes the whole CUP panel down.
  assert.match(
    panel,
    /'<label class="phab-admin-notifications-field"><span>PadlHub ID пользователей<\/span>' \+\s*\n\s*'<textarea[^']*data-notification-user-ids><\/textarea><\/label>' \+/,
    'the composer must render a PadlHub ID textarea'
  );
  assert.match(
    panel,
    /var notificationUserIdsInput = notificationNode\('\[data-notification-user-ids\]'\);/,
    'the PadlHub ID textarea must be resolved to a control reference'
  );
  assert.match(
    panel,
    /notificationUserIdsInput: notificationUserIdsInput,/,
    'the PadlHub ID control must be exposed on the shared DOM map'
  );
  assert.match(
    panel,
    /notificationUserIdWarning: notificationUserIdWarning,/,
    'the warning control must be exposed on the shared DOM map'
  );
  assert.match(
    panel,
    /\[dom\.notificationPhonesInput, dom\.notificationUserIdsInput\]\.forEach\(function \(input\) \{/,
    'editing either recipient field must invalidate the preview'
  );

  // Validation and gating.
  assert.match(
    panel,
    /if \(NOTIFICATION_USER_ID_PATTERN\.test\(userId\)\) ids\.push\(userId\);\s*\n\s*else invalid\.push\(userId\);/,
    'a malformed id must be collected as invalid instead of being dropped'
  );
  assert.match(
    panel,
    /var blocked = hasInvalidUserIds \|\| overLimit \|\| Boolean\(notificationState\.busy\);/,
    'malformed ids and over-limit selections must be computed as a blocking state'
  );
  assert.match(
    panel,
    /var overLimit = selection\.total > NOTIFICATION_RECIPIENT_LIMIT;/,
    'the composer must enforce the documented 100-value limit'
  );
  assert.match(
    panel,
    /dom\.notificationPreviewBtn\.disabled = selection\.total === 0 \|\| blocked;/,
    'a blocked or empty selector must disable the recipient preview'
  );
  assert.match(
    panel,
    /notificationState\.resolution\.matched\.length === 0 \|\|\s*\n\s*blocked \|\|/,
    'a blocked selector must disable sending'
  );

  // A resolve answer that arrives after the recipients changed must be discarded.
  assert.match(
    panel,
    /notificationState\.recipientRevision \+= 1;/,
    'editing recipients must invalidate an in-flight resolution'
  );
  assert.match(
    panel,
    /if \(revision !== notificationState\.recipientRevision\) \{/,
    'a stale resolution must not re-arm the send button'
  );

  // Response handling.
  assert.match(
    panel,
    /Array\.isArray\(resolution\.unresolvedUserIds\)/,
    'the additive unresolvedUserIds field must be read defensively'
  );
  assert.match(
    panel,
    /String\(recipient\.phoneMasked \|\| recipient\.userId \|\| ''\)/,
    'a recipient resolved by user id has no masked phone and must fall back to the id'
  );
  assert.match(
    panel,
    /var skipped =\s*\n\s*\(Array\.isArray\(previewResolution\.unresolvedPhones\)/,
    'a partial campaign must report the values that reached nobody, not the API value counter'
  );
  assert.match(
    panel,
    /notificationValueWord\(skipped\)/,
    'the partial-campaign line must pluralise the skipped count'
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
