import { strict as assert } from 'assert';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * The operator writes one title and one body for the inbox and for the system banner. The API keeps the
 * 300-character inbox limit, but the operating system truncates the banner far earlier, so the composer
 * shows a live budget instead of a second hard limit. The panel is a browser asset without a unit-test
 * runtime, so this guards the served contract: the counters are wired to the normal input path, they warn
 * without blocking, and they never replace the API limit.
 */
async function main(): Promise<void> {
  const panel = readFileSync(resolve(__dirname, '../client-sdk/phab-admin-panel.js'), 'utf8');

  // The banner budget is a presentation constant, not a new API rule.
  assert.match(
    panel,
    /var NOTIFICATION_BANNER_TITLE_LIMIT = 40;\s*\n\s*var NOTIFICATION_BANNER_TITLE_IOS_LIMIT = 30;\s*\n\s*var NOTIFICATION_BANNER_BODY_LIMIT = 120;/,
    'the composer must carry the documented banner budget'
  );
  assert.match(
    panel,
    /maxlength="300" placeholder="Изменение времени игры" data-notification-title>/,
    'the title input must keep the 300-character inbox limit'
  );

  // Each counter needs its own node, otherwise the status text and the count would overwrite each other.
  assert.match(
    panel,
    /<small class="phab-admin-notifications-meta phab-admin-notifications-budget" data-notification-title-budget>Баннер покажет до 40 символов<\/small>/,
    'the title needs a budget hint next to the input'
  );
  assert.match(
    panel,
    /<small class="phab-admin-notifications-meta phab-admin-notifications-budget" data-notification-body-budget>Баннер покажет первые 120 символов<\/small>/,
    'the body needs its own budget hint'
  );
  assert.match(
    panel,
    /var notificationTitleBudget = notificationNode\('\[data-notification-title-budget\]'\);/,
    'the title budget node must be resolved to a control reference'
  );
  assert.match(
    panel,
    /var notificationBodyBudget = notificationNode\('\[data-notification-body-budget\]'\);/,
    'the body budget node must be resolved to a control reference'
  );
  assert.match(
    panel,
    /notificationTitleBudget: notificationTitleBudget,\s*\n\s*notificationBodyInput: notificationBodyInput,\s*\n\s*notificationBodyBudget: notificationBodyBudget,/,
    'both budget nodes must be exposed on the shared DOM map'
  );

  // The counter rides the existing input path: no extra listener can drift out of sync with the buttons.
  assert.match(
    panel,
    /function renderNotificationTextBudget\(\) \{\s*\n\s*var titleLength = String\(dom\.notificationTitleInput\.value \|\| ''\)\.trim\(\)\.length;/,
    'the budget must count the same trimmed value that is sent'
  );
  assert.match(
    panel,
    /function updateNotificationControls\(\) \{\s*\n\s*var selection = notificationRecipientSelection\(\);\s*\n\s*var selectedChannels = selectedNotificationChannels\(\);\s*\n\s*renderNotificationTextBudget\(\);/,
    'every control refresh must refresh the budget'
  );
  assert.match(
    panel,
    /dom\.notificationTitleBudget\.classList\.toggle\('is-over', titleOver\);/,
    'an over-long title must be marked as over budget'
  );
  assert.match(
    panel,
    /titleText \+= ' — баннер обрежет заголовок, в Центре уведомлений он останется целиком';/,
    'an over-long title must say where the full text remains'
  );
  assert.match(
    panel,
    /var titleTight = !titleOver && titleLength > NOTIFICATION_BANNER_TITLE_IOS_LIMIT;/,
    'the tighter iOS banner must be called out before the general limit'
  );
  assert.match(
    panel,
    /dom\.notificationTitleBudget\.classList\.toggle\('is-tight', titleTight\);/,
    'the iOS tone must be a modifier next to the muted base style'
  );
  assert.match(
    panel,
    /bodyLength \+\s*\n\s*' символов — в баннер войдут первые ' \+\s*\n\s*NOTIFICATION_BANNER_BODY_LIMIT \+\s*\n\s*', остальное видно в Центре уведомлений'/,
    'an over-long body must point at the inbox for the rest'
  );

  // The budget is a warning: the untouched send conditions must not gain a length gate.
  const sendGate = /dom\.notificationSendBtn\.disabled =\s*\n([\s\S]*?);\n/.exec(panel)?.[1] ?? '';
  assert.ok(sendGate.length > 0, 'the send button state must stay in the shared control refresh');
  assert.equal(
    /TitleLimit|BodyLimit/.test(sendGate),
    false,
    'the banner budget must never disable sending'
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
