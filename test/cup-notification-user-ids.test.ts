import { strict as assert } from 'assert';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * The CUP notification composer may address recipients by phone number and/or by PadlHub user id.
 * The panel is a browser asset without a unit-test runtime, so this guards the served contract: the
 * request payloads carry a selector object, a malformed PadlHub id is surfaced instead of silently
 * dropped, and the additive `unresolvedUserIds` response field is read defensively.
 */
async function main(): Promise<void> {
  const panel = readFileSync(resolve(__dirname, '../client-sdk/phab-admin-panel.js'), 'utf8');

  assert.match(
    panel,
    /resolveRecipients: function \(selector\) \{[\s\S]{0,220}?'POST',\s*\n\s*selector,/,
    'recipient resolution must forward the whole selector, not a phone-only payload'
  );

  assert.match(
    panel,
    /data-notification-user-ids/,
    'the composer must expose a PadlHub ID field'
  );
  assert.match(
    panel,
    /data-notification-user-id-warning/,
    'the composer must expose a warning node for malformed PadlHub ids'
  );

  assert.match(
    panel,
    /function parseNotificationUserIds\(\)/,
    'PadlHub ids must be parsed and validated before sending'
  );
  assert.match(
    panel,
    /NOTIFICATION_USER_ID_PATTERN\s*=\s*\n?\s*\/\^\[0-9a-f\]\{8\}-\[0-9a-f\]\{4\}-\[0-9a-f\]\{4\}-\[0-9a-f\]\{4\}-\[0-9a-f\]\{12\}\$\//,
    'the id check must accept canonical UUIDs only'
  );
  assert.match(
    panel,
    /if \(NOTIFICATION_USER_ID_PATTERN\.test\(userId\)\) ids\.push\(userId\);\s*\n\s*else invalid\.push\(userId\);/,
    'a malformed id must be collected as invalid instead of being dropped'
  );
  assert.match(
    panel,
    /dom\.notificationPreviewBtn\.disabled =\s*\n\s*selection\.phones \+ selection\.userIds === 0 \|\|\s*\n\s*hasInvalidUserIds \|\|/,
    'a malformed id must block the recipient preview'
  );
  assert.match(
    panel,
    /dom\.notificationSendBtn\.disabled =[\s\S]{0,400}?hasInvalidUserIds \|\|/,
    'a malformed id must block sending the campaign'
  );

  assert.match(
    panel,
    /Object\.assign\(\{\}, notificationRecipientSelection\(\)\.selector, \{/,
    'the campaign payload must be built from the recipient selector'
  );
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
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
