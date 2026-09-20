import { strict as assert } from 'assert';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * The CUP delivery report exists because Web Push has no provider dashboard: the operator can only see
 * what our own records say. The panel is a browser asset without a unit-test runtime, so this guards the
 * served contract: the read is the documented admin path, the report is rendered as text (never as
 * markup built from server values), the wording keeps "accepted by the push service" distinct from "seen
 * on the device", and the subscriber row names the push service behind a subscription.
 */
async function main(): Promise<void> {
  const panel = readFileSync(resolve(__dirname, '../client-sdk/phab-admin-panel.js'), 'utf8');

  // The read must go through the shared admin request helper, like every other operator read.
  assert.match(
    panel,
    /getDeliveryStats: function \(days\) \{\s*\n\s*return adminRequest\(\s*\n\s*'\/notifications\/delivery-stats\?days=' \+ encodeURIComponent\(String\(days\)\),\s*\n\s*'GET',\s*\n\s*null,\s*\n\s*'',\s*\n\s*true\s*\n\s*\);/,
    'the report must read the admin delivery-stats path with the period'
  );

  // Markup, controls and the shared DOM map are one wiring unit.
  assert.match(panel, /<summary>Доставка пушей<\/summary>/, 'the composer must offer the report');
  assert.match(
    panel,
    /<select class="phab-admin-input" data-notification-stats-days>/,
    'the report needs a period control'
  );
  assert.match(
    panel,
    /'<option value="1">1 день<\/option><option value="7" selected>7 дней<\/option><option value="30">30 дней<\/option><option value="90">90 дней<\/option>'/,
    'the period control must offer the documented windows with a default'
  );
  assert.match(
    panel,
    /data-notification-stats-load>Показать отчёт</,
    'the report needs an explicit load control'
  );
  assert.match(
    panel,
    /data-notification-stats-status>Отчёт ещё не загружен\.</,
    'the status message needs its own node'
  );
  for (const block of ['summary', 'failures', 'endpoints', 'campaigns']) {
    assert.match(
      panel,
      new RegExp(`data-notification-stats-${block}></div>`),
      `the report needs its ${block} block`
    );
    assert.match(
      panel,
      new RegExp(`var notificationStats${block[0]!.toUpperCase()}${block.slice(1)} = notificationNode`),
      `the ${block} block must be resolved to a control reference`
    );
    assert.match(
      panel,
      new RegExp(`notificationStats${block[0]!.toUpperCase()}${block.slice(1)}: notificationStats`),
      `the ${block} block must be exposed on the shared DOM map`
    );
  }
  assert.match(
    panel,
    /dom\.notificationStatsLoad\.addEventListener\('click', function \(\) \{\s*\n\s*loadNotificationDeliveryStats\(\)\.catch\(handleError\);/,
    'the load button must trigger the read'
  );

  // "Accepted" must stay distinguishable from "displayed": the wording is the product contract.
  assert.match(
    panel,
    /«Принято» — это приём пуш-сервисом, а не показ на устройстве\./,
    'the report must explain what acceptance does and does not mean'
  );
  assert.match(
    panel,
    /У Web Push нет отчётов от провайдера, поэтому источник — собственные записи/,
    'the section must explain where the numbers come from'
  );

  // Server values become text, never markup.
  const renderBlock = /function renderNotificationDeliveryStats\(stats\) \{[\s\S]*?\n    \}\n/.exec(
    panel,
  )?.[0];
  assert.ok(renderBlock, 'the report renderer must exist');
  assert.equal(
    /innerHTML/.test(renderBlock),
    false,
    'the report must render server values as text, never as markup'
  );
  assert.match(
    panel,
    /function appendNotificationStatLine\(container, text\) \{\s*\n\s*var line = document\.createElement\('div'\);\s*\n\s*line\.className = 'phab-admin-notifications-meta';\s*\n\s*line\.textContent = text;/,
    'each report line must be created as a text node'
  );

  // The subscriber row has to say which push service answered and whether the confirmation is old.
  assert.match(
    panel,
    /notificationPlatformSuffix\(subscriber\.platforms\)/,
    'a subscriber row must name the push service behind the subscription'
  );
  assert.match(
    panel,
    /notificationConfirmationSuffix\(subscriber\.lastConfirmedAt\)/,
    'a subscriber row must show when the subscription was last confirmed'
  );
  assert.match(
    panel,
    /var labels = \{ CHROME: 'Chrome', SAFARI: 'iPhone\/iPad', OTHER: 'другое' \};/,
    'the platform labels must map the contract values'
  );
  assert.match(
    panel,
    /var NOTIFICATION_STALE_CONFIRMATION_DAYS = 7;/,
    'the stale-confirmation threshold must be explicit'
  );
  assert.match(
    panel,
    /' \(давно — вероятно, устройство заменено\)'/,
    'a stale confirmation must be visible to the operator'
  );

  // Every failure path has to keep the operator informed instead of clearing the rendered report.
  assert.match(
    panel,
    /error && error\.message \? error\.message : 'Не удалось загрузить отчёт\.'/,
    'a failed read must report a message'
  );
  assert.equal(
    panel.split('setNotificationResult(dom.notificationStatsSummary').length - 1,
    0,
    'status messages must not target a report block'
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
