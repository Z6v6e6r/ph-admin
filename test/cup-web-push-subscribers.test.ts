import { strict as assert } from 'assert';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * The CUP can list the accounts that can receive a Web Push right now and add one of them to the
 * campaign recipients. The panel is a browser asset without a unit-test runtime, so this guards the
 * served contract: the read is keyset-paginated with the documented query, the rows cannot be wiped by
 * a status message, and choosing a row appends a PadlHub id through the normal recipient input path.
 */
async function main(): Promise<void> {
  const panel = readFileSync(resolve(__dirname, '../client-sdk/phab-admin-panel.js'), 'utf8');

  assert.match(
    panel,
    /listWebPushSubscribers: function \(limit, cursor\) \{\s*\n\s*var query = '\?limit=' \+ encodeURIComponent\(String\(limit\)\);/,
    'the client must request a bounded page of Web Push subscribers'
  );
  assert.match(
    panel,
    /return adminRequest\('\/notifications\/web-push-subscribers' \+ query, 'GET', null, '', true\);/,
    'the subscriber read must be a GET on the admin subscriber path'
  );
  assert.match(
    panel,
    /if \(cursor\) query \+= '&cursor=' \+ encodeURIComponent\(String\(cursor\)\);/,
    'the keyset cursor must be forwarded when present'
  );

  // Markup, control references and the shared DOM map are one wiring unit.
  assert.match(
    panel,
    /<summary>У кого подключён Web Push<\/summary>/,
    'the composer must offer the Web Push subscriber list'
  );
  assert.match(
    panel,
    /data-notification-subscribers-load>Показать список</,
    'the list needs an explicit load control'
  );
  assert.match(
    panel,
    /data-notification-subscribers-status>Список ещё не загружен\.</,
    'status messages need their own node'
  );
  assert.match(
    panel,
    /var notificationSubscribersList = notificationNode\('\[data-notification-subscribers-list\]'\);/,
    'the list container must be resolved to a control reference'
  );
  assert.match(
    panel,
    /notificationSubscribersStatus: notificationSubscribersStatus,/,
    'the status node must be exposed on the shared DOM map'
  );
  assert.match(
    panel,
    /dom\.notificationSubscribersMore\.addEventListener\('click', function \(\) \{\s*\n\s*loadNotificationSubscribers\(\{ append: true \}\)/,
    'the more button must load the next keyset page'
  );

  // A status message must never destroy the rendered rows.
  assert.match(
    panel,
    /function renderNotificationSubscribers\(items, append\) \{\s*\n\s*if \(!append\) dom\.notificationSubscribersList\.textContent = '';/,
    'only a fresh load may clear the list container'
  );
  assert.equal(
    panel.split('setNotificationResult(dom.notificationSubscribersList').length - 1,
    0,
    'status messages must target the status node, not the list container'
  );

  // Choosing a row goes through the normal recipient input so the preview invalidates as usual.
  assert.match(
    panel,
    /row\.setAttribute\('data-notification-subscriber', String\(subscriber\.userId \|\| ''\)\);/,
    'each row must carry the PadlHub id it stands for'
  );
  assert.match(
    panel,
    /dom\.notificationUserIdsInput\.value = current\.trim\(\) \? current\.replace\(\/\\s\+\$\/, ''\) \+ '\\n' \+ userId : userId;/,
    'choosing a row must append the PadlHub id to the recipients field'
  );
  assert.match(
    panel,
    /dom\.notificationUserIdsInput\.dispatchEvent\(new window\.Event\('input', \{ bubbles: true \}\)\);/,
    'appending a recipient must reuse the normal input path'
  );
  assert.match(
    panel,
    /if \(existing\.indexOf\(userId\.toLowerCase\(\)\) >= 0\) \{/,
    'a recipient that is already in the field must not be added twice'
  );
  assert.match(
    panel,
    /notificationState\.subscriberCursor = String\(\(page && page\.nextCursor\) \|\| ''\);/,
    'the next page cursor must be kept for the more button'
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
