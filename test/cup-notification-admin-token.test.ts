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
  // The capabilities read is the proof of the token and of the notifications.manage permission, and it
  // must not fall back to the cookie session: that retry would report a rejected token as accepted.
  assert.match(
    panel,
    /getCapabilities: function \(allowRefresh\) \{/,
    'capabilities must accept an explicit refresh policy'
  );
  assert.match(
    panel,
    /return adminRequest\('\/notifications\/capabilities', 'GET', null, '', allowRefresh !== false\);/,
    'capabilities must be requestable without the cookie-session fallback'
  );
  assert.match(
    panel,
    /notificationState\.capabilities = await notificationApi\.getCapabilities\(false\);/,
    'the pasted token must be verified without the cookie fallback'
  );
  assert.match(
    panel,
    /await loadNotificationCapabilities\(\{ allowRefresh: false \}\);/,
    'a stored token must be verified without the cookie fallback too'
  );
  assert.match(
    panel,
    /getCapabilities\(false\);\s*\n\s*storeNotificationToken\(token\);\s*\n\s*dom\.notificationAdminTokenInput\.value = '';\s*\n\s*renderNotificationCapabilities\(\);\s*\n\s*showNotificationWorkspace\(\);/,
    'the workspace must open only after the token was verified'
  );
  // The order above is not enough on its own: a second, earlier open would also satisfy it.
  const tokenLoginStart = panel.indexOf('async function submitNotificationTokenLogin');
  const tokenVerifyIndex = panel.indexOf('getCapabilities(false)', tokenLoginStart);
  assert.ok(tokenLoginStart >= 0 && tokenVerifyIndex > tokenLoginStart, 'token login must verify the token');
  assert.ok(
    !panel.slice(tokenLoginStart, tokenVerifyIndex).includes('showNotificationWorkspace'),
    'the workspace must not be opened before the token was verified'
  );
  // The refresh policy argument must not be overridden inside the capabilities request.
  const capabilitiesStart = panel.indexOf('getCapabilities: function (allowRefresh)');
  assert.ok(capabilitiesStart >= 0, 'capabilities must accept a refresh policy');
  const capabilitiesBody = panel.slice(capabilitiesStart, panel.indexOf('},', capabilitiesStart));
  assert.doesNotMatch(
    capabilitiesBody,
    /allowRefresh\s*=\s*true/,
    'the capabilities request must not force the cookie-session fallback'
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
    /localStorage\.setItem\([^)]*phab_notification_admin_token/,
    'the admin token must never be written to localStorage, not even by its literal key'
  );

  // A rejected token must forget both the stored value and the value in the field.
  assert.match(
    panel,
    /notificationApi\.setAccessToken\(''\);\s*\n\s*notificationState\.session = null;\s*\n\s*notificationState\.capabilities = null;\s*\n\s*storeNotificationToken\(''\);\s*\n\s*dom\.notificationAdminTokenInput\.value = '';/,
    'a rejected token must be forgotten while the phone login stays available'
  );

  // An expired session must return the operator to the login card from both admin calls.
  assert.equal(
    panel.split('if (notificationSessionExpired(error)) return;').length - 1,
    2,
    'preview and send must both handle an expired session'
  );
  assert.match(
    panel,
    /function notificationSessionExpired\(error\) \{\s*\n\s*if \(!error \|\| \(error\.status !== 401 && error\.status !== 403\)\) return false;/,
    'only an auth failure may close the notification session'
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
