import { strict as assert } from 'assert';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * The notification block can be opened with a short-lived PadlHub admin token while the target
 * contour has no code delivery. The panel is a browser asset without a unit-test runtime, so this
 * guards the served contract: the token is wired into the composer, verified by the first admin
 * request, kept in this tab only, rejected when it is not a JWT, and forgotten on logout.
 */
async function main(): Promise<void> {
  const panel = readFileSync(resolve(__dirname, '../client-sdk/phab-admin-panel.js'), 'utf8');

  // The notification API client can adopt and report an operator-supplied token.
  assert.match(
    panel,
    /setAccessToken: function \(token\) \{\s*\n\s*accessToken = String\(token \|\| ''\);/,
    'the notification client must accept an operator-supplied access token'
  );
  assert.match(
    panel,
    /hasAccessToken: function \(\) \{\s*\n\s*return Boolean\(accessToken\);/,
    'the notification client must expose whether a token is set'
  );

  // The field, its button, the DOM map and the listener are one wiring unit.
  assert.match(
    panel,
    /<summary>Технический вход по admin-токену \(временно\)<\/summary>/,
    'the composer must offer the technical token login'
  );
  assert.match(
    panel,
    /type="password" autocomplete="off" spellcheck="false"[^>]*data-notification-admin-token/,
    'the token field must be a non-autocompleted password input'
  );
  assert.match(
    panel,
    /var notificationAdminTokenInput = notificationNode\('\[data-notification-admin-token\]'\);/,
    'the token field must be resolved to a control reference'
  );
  assert.match(
    panel,
    /notificationAdminTokenInput: notificationAdminTokenInput,/,
    'the token field must be exposed on the shared DOM map'
  );
  assert.match(
    panel,
    /notificationTokenLoginBtn: notificationTokenLoginBtn,/,
    'the token button must be exposed on the shared DOM map'
  );
  assert.match(
    panel,
    /dom\.notificationTokenLoginBtn\.addEventListener\('click', function \(\) \{\s*\n\s*submitNotificationTokenLogin\(\)/,
    'the token button must run the token login'
  );

  // A malformed token never reaches the API.
  assert.match(
    panel,
    /if \(token\.split\('\.'\)\.length !== 3\) \{/,
    'a value that is not a JWT must be rejected before any request'
  );
  // The capabilities read is the proof of the token and of the notifications.manage permission.
  assert.match(
    panel,
    /notificationState\.capabilities = await notificationApi\.getCapabilities\(\);/,
    'the token must be verified by the first admin request'
  );

  // Tab-scoped storage only, and forgotten on logout.
  assert.match(
    panel,
    /var NOTIFICATION_TOKEN_STORAGE_KEY = 'phab_notification_admin_token';/,
    'the token must have a dedicated storage key'
  );
  assert.match(
    panel,
    /window\.sessionStorage\.setItem\(NOTIFICATION_TOKEN_STORAGE_KEY, token\)/,
    'the token must be stored in sessionStorage, never in localStorage'
  );
  assert.doesNotMatch(
    panel,
    /localStorage\.setItem\(NOTIFICATION_TOKEN_STORAGE_KEY/,
    'the admin token must never be written to localStorage'
  );
  assert.match(
    panel,
    /var storedToken = readStoredNotificationToken\(\);[\s\S]{0,220}?notificationApi\.setAccessToken\(storedToken\);/,
    'a stored token must be tried before the phone flow'
  );
  assert.match(
    panel,
    /cfg\.authToken = '';\s*\n\s*storeNotificationToken\(''\);/,
    'logout must forget the notification token'
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
