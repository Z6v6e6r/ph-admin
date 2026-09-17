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
  // An empty selector array must never be sent: the API rejects `{phones: []}` and `{userIds: []}`.
  assert.match(
    panel,
    /if \(phones\.length\) selector\.phones = phones;/,
    'an empty phone selector must be omitted from the payload'
  );
  assert.match(
    panel,
    /if \(userIds\.ids\.length\) selector\.userIds = userIds\.ids;/,
    'an empty user-id selector must be omitted from the payload'
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
    /var contact = String\(\(recipient && recipient\.phoneMasked\) \|\| 'без телефона'\);/,
    'a recipient without a masked phone must be labelled instead of printing an empty contact'
  );
  assert.match(
    panel,
    /var id = String\(\(recipient && recipient\.userId\) \|\| ''\)\.slice\(0, 8\);/,
    'the preview must show which PadlHub account a phone resolved to'
  );
  assert.match(
    panel,
    /var notes = \[channels\.length \? channels\.join\(' \+ '\) : 'нет доступных каналов'\];/,
    'the preview must show the channels an account can receive on'
  );
  assert.match(
    panel,
    /'Внимание: Web Push недоступен у ' \+\s*\n\s*withoutWebPush\.length \+\s*\n\s*' из ' \+\s*\n\s*matched\.length \+/,
    'a phone that resolved to an account without Web Push must warn the operator'
  );
  // The warning and the ordering must follow the SELECTED channels, not an account's total channels.
  assert.match(
    panel,
    /function selectedChannelCount\(recipient\) \{\s*\n\s*return notificationRecipientChannels\(recipient\)\.filter\(function \(channel\) \{\s*\n\s*return selected\.indexOf\(channel\) >= 0;/,
    'reachability must be measured against the selected channels'
  );
  assert.match(
    panel,
    /var ordered = matched\.slice\(\)\.sort\(function \(left, right\) \{\s*\n\s*return selectedChannelCount\(right\) - selectedChannelCount\(left\);/,
    'the preview must list reachable recipients first for every selected channel'
  );
  assert.match(
    panel,
    /var nothingReachable = matched\.filter\(function \(recipient\) \{\s*\n\s*return selectedChannelCount\(recipient\) === 0;/,
    'recipients without any selected channel must be counted separately'
  );
  assert.match(
    panel,
    /:\s*у них нет ни одного из выбранных каналов\./,
    'a recipient with no channels at all must not be promised in-app delivery'
  );
  assert.match(
    panel,
    /matched\.length === 0 \|\| nothingReachable\.length === matched\.length/,
    'only a fully undeliverable preview may be styled as an error'
  );
  // Changing the channels changes what the preview means, so it must invalidate the preview.
  assert.match(
    panel,
    /dom\.notificationChannelInputs\.forEach\(function \(input\) \{\s*\n\s*input\.addEventListener\('change', function \(\) \{\s*\n\s*\/\/ The preview is computed per selected channel, so changing the channels makes it stale\.\s*\n\s*notificationState\.resolution = null;/,
    'a channel change must invalidate the recipient preview'
  );
  assert.match(
    panel,
    /notificationRecipientWord\(ordered\.length - 20\)/,
    'the truncation line must use a plural form'
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
