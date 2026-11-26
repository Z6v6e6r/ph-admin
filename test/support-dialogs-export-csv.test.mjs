import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

test('dialog CSV writes message and client fields as literal spreadsheet text', () => {
  const asset = process.argv[2] ?? new URL('../client-sdk/phab-admin-panel.js', import.meta.url);
  const source = readFileSync(asset, 'utf8');
  const start = source.indexOf('    function escapeCsvCell(');
  const end = source.indexOf('    function buildDialogsExportFileName(', start);
  assert.ok(start >= 0 && end > start);
  const context = vm.createContext({ isObject: value => value !== null && typeof value === 'object' });
  vm.runInContext(source.slice(start, end), context);

  const csv = context.buildDialogsExportCsv({
    dialogs: [{
      clientDisplayName: '=literal',
      subject: 'обычный, "текст"',
      messages: [{
        text: ' \t@literal',
        senderName: '＝literal',
        phone: '+7',
        ai: { summary: '-literal' }
      }]
    }]
  });
  for (const literal of ["'=literal", "' \t@literal", "'＝literal", "'+7", "'-literal"]) {
    assert.ok(csv.includes(literal), literal);
  }
  assert.ok(csv.includes('"обычный, ""текст"""'));
});
