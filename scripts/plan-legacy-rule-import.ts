import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  planLegacyRuleImport,
  renderLegacyRuleImportPlanMarkdown,
  type LegacyRuleInventory,
} from '../src/subscriptions/legacy-rule-import-planner';

/**
 * Read-only operator tool. It maps an LK1 active-rule inventory into the CUP policy model and
 * prints/writes a review plan. It never contacts a database, provider or CUP and never publishes.
 *
 * Usage:
 *   npx ts-node scripts/plan-legacy-rule-import.ts --inventory=<path> [--out=<file>] [--json]
 */
function argument(name: string): string | undefined {
  return process.argv.find((item) => item.startsWith(`--${name}=`))?.slice(name.length + 3);
}

const inventoryPath = argument('inventory');
if (!inventoryPath) {
  process.stderr.write('Use --inventory=<path to lk1-rules-inventory.json>\n');
  process.exit(2);
}
const raw = fs.readFileSync(path.resolve(inventoryPath), 'utf8');
const inventory = JSON.parse(raw) as LegacyRuleInventory;
if (
  !inventory ||
  inventory.schemaVersion !== 1 ||
  !Array.isArray(inventory.products) ||
  !Array.isArray(inventory.rules)
) {
  process.stderr.write('Inventory schema is not supported\n');
  process.exit(2);
}

const plan = planLegacyRuleImport(inventory);
const out = argument('out');
if (out) {
  const target = path.resolve(out);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const isJson = process.argv.includes('--json') || target.endsWith('.json');
  fs.writeFileSync(target, isJson ? `${JSON.stringify(plan, null, 2)}\n` : renderLegacyRuleImportPlanMarkdown(plan));
  process.stdout.write(`Plan written to ${target}\n`);
}
process.stdout.write(
  `products=${plan.summary.products} rules=${plan.summary.rules} direct=${plan.summary.direct} ` +
    `partial=${plan.summary.partial} other_source=${plan.summary.otherSource} ` +
    `unmapped=${plan.summary.unmapped} ready=${plan.summary.readyProducts} ` +
    `conflicts=${plan.conflicts} gaps=${plan.gaps}\n`
);
