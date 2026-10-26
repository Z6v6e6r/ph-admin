/**
 * Deterministic mapping plan from the LK1 active-rule inventory into the CUP policy model.
 *
 * The plan is intentionally conservative: it never claims that a product is ready to publish when
 * a rule needs a product decision (free minutes vs. usage units, station identifiers, level rules
 * owned by LK2, missing confirmed prices). `readyToPublish` is only true when every rule is a direct
 * mapping and the product has exactly one verified provider product id. Today no LK1 product meets
 * that bar, so the output is an operator review list with explicit blockers, not an import.
 */
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,199}$/;

export interface LegacyRuleInventory {
  readonly schemaVersion: 1;
  readonly generatedAt: string;
  readonly repo: { readonly url: string; readonly sha: string; readonly date: string };
  readonly products: readonly LegacyRuleProduct[];
  readonly rules: readonly LegacyRule[];
  readonly conflicts: readonly unknown[];
  readonly gaps: readonly unknown[];
}

export interface LegacyRuleProduct {
  readonly productId: string;
  readonly name: string;
  readonly status: string;
  readonly aliases?: readonly string[];
  readonly vivaProductIds?: readonly string[];
  readonly stations?: readonly string[];
}

export interface LegacyRule {
  readonly ruleId: string;
  readonly productId: string;
  readonly ruleGroup: string;
  readonly value: unknown;
  readonly status: string;
  readonly unit?: string;
  readonly period?: string;
  readonly confidence?: string;
}

export type LegacyRuleCupTarget =
  | 'PRODUCT_VALIDITY'
  | 'DAILY_USAGE'
  | 'ACTIVE_SERVICES'
  | 'BENEFIT_RULE'
  | 'CREATE_JOIN'
  | 'STATION_ACCESS'
  | 'LK2_LEVEL'
  | 'UNMAPPED';

export type LegacyRuleMappingStatus = 'DIRECT' | 'PARTIAL' | 'OTHER_SOURCE' | 'UNMAPPED';

export interface LegacyRuleMapping {
  readonly ruleId: string;
  readonly productId: string;
  readonly ruleGroup: string;
  readonly physicalGroup: 'CUP_POLICY' | 'LK2_LEVEL' | 'UNMAPPED';
  readonly cupTarget: LegacyRuleCupTarget;
  readonly status: LegacyRuleMappingStatus;
  readonly reason: string;
}

export interface LegacyProductPlan {
  readonly productId: string;
  readonly name: string;
  readonly sourceStatus: string;
  readonly providerProductId: string | null;
  readonly ruleCount: number;
  readonly mappings: readonly LegacyRuleMapping[];
  readonly blockers: readonly string[];
  readonly readyToPublish: boolean;
}

export interface LegacyRuleImportPlan {
  readonly schemaVersion: 1;
  readonly source: { readonly url: string; readonly sha: string; readonly date: string };
  readonly generatedAt: string;
  readonly summary: {
    readonly products: number;
    readonly rules: number;
    readonly direct: number;
    readonly partial: number;
    readonly otherSource: number;
    readonly unmapped: number;
    readonly readyProducts: number;
  };
  readonly products: readonly LegacyProductPlan[];
  readonly conflicts: number;
  readonly gaps: number;
}

const RULE_GROUP_INDEX: Record<
  string,
  { cupTarget: LegacyRuleCupTarget; physicalGroup: LegacyRuleMapping['physicalGroup']; status: LegacyRuleMappingStatus; reason: string }
> = {
  subscription_applicability: {
    cupTarget: 'PRODUCT_VALIDITY',
    physicalGroup: 'CUP_POLICY',
    status: 'PARTIAL',
    reason: 'validity/visits are transferable, but product/station scope and confirmed price need a product decision',
  },
  usage_limits: {
    cupTarget: 'DAILY_USAGE',
    physicalGroup: 'CUP_POLICY',
    status: 'PARTIAL',
    reason: 'the inventory counts free minutes; CUP usage is a request/visit counter and the conversion needs approval',
  },
  active_future_bookings: {
    cupTarget: 'ACTIVE_SERVICES',
    physicalGroup: 'CUP_POLICY',
    status: 'PARTIAL',
    reason: 'the limit value is known; the CUP active-service scope (benefit-only vs all bookings) is a product decision',
  },
  payment_cancel: {
    cupTarget: 'BENEFIT_RULE',
    physicalGroup: 'CUP_POLICY',
    status: 'PARTIAL',
    reason: 'percent/fixed discounts need a benefit-rule mapping and an approved station/event scope',
  },
  time_duration: {
    cupTarget: 'CREATE_JOIN',
    physicalGroup: 'CUP_POLICY',
    status: 'PARTIAL',
    reason: 'duration lists are transferable; per-action enablement and boundary values need approval',
  },
  stations_exceptions: {
    cupTarget: 'STATION_ACCESS',
    physicalGroup: 'CUP_POLICY',
    status: 'PARTIAL',
    reason: 'the inventory often describes stations by name; CUP requires canonical station ids',
  },
  availability: {
    cupTarget: 'CREATE_JOIN',
    physicalGroup: 'CUP_POLICY',
    status: 'PARTIAL',
    reason: 'sale/availability limits need explicit CreateGame/JoinGame projection fields',
  },
  player_admission: {
    cupTarget: 'LK2_LEVEL',
    physicalGroup: 'LK2_LEVEL',
    status: 'OTHER_SOURCE',
    reason: 'participation admission is owned by LK2 level rules, not by the CUP subscription policy',
  },
};

function productStatusBlockers(product: LegacyRuleProduct): string[] {
  const blockers: string[] = [];
  if (product.status !== 'ACTIVE') blockers.push(`PRODUCT_STATUS_${product.status}`);
  const ids = product.vivaProductIds ?? [];
  if (ids.length !== 1) blockers.push('PROVIDER_PRODUCT_ID_NOT_UNIQUE');
  if (ids.length === 1 && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ids[0] as string)) {
    blockers.push('PROVIDER_PRODUCT_ID_NOT_CANONICAL');
  }
  if (!product.vivaProductIds || product.vivaProductIds.length === 0) {
    blockers.push('PROVIDER_PRODUCT_ID_MISSING');
  }
  return blockers;
}

function mapRule(rule: LegacyRule): LegacyRuleMapping {
  const index = RULE_GROUP_INDEX[rule.ruleGroup];
  if (!index || !ID_PATTERN.test(rule.ruleId) || !ID_PATTERN.test(rule.productId)) {
    return {
      ruleId: rule.ruleId,
      productId: rule.productId,
      ruleGroup: rule.ruleGroup,
      physicalGroup: 'UNMAPPED',
      cupTarget: 'UNMAPPED',
      status: 'UNMAPPED',
      reason: 'no CUP/LK2 target is defined for this rule group',
    };
  }
  return {
    ruleId: rule.ruleId,
    productId: rule.productId,
    ruleGroup: rule.ruleGroup,
    physicalGroup: index.physicalGroup,
    cupTarget: index.cupTarget,
    status: index.status,
    reason: index.reason,
  };
}

export function planLegacyRuleImport(
  inventory: LegacyRuleInventory,
  generatedAt = new Date().toISOString()
): LegacyRuleImportPlan {
  const mappings = inventory.rules.map(mapRule);
  const products = inventory.products.map((product): LegacyProductPlan => {
    const productMappings = mappings.filter((mapping) => mapping.productId === product.productId);
    const providerProductId =
      (product.vivaProductIds ?? []).length === 1 ? (product.vivaProductIds?.[0] ?? null) : null;
    const blockers = [
      ...productStatusBlockers(product),
      ...(inventory.conflicts.length > 0 ? ['INVENTORY_CONFLICTS_PRESENT'] : []),
      ...productMappings
        .filter((mapping) => mapping.status === 'PARTIAL')
        .map((mapping) => `PARTIAL_MAPPING:${mapping.ruleId}`),
      ...productMappings
        .filter((mapping) => mapping.status === 'UNMAPPED')
        .map((mapping) => `UNMAPPED_RULE:${mapping.ruleId}`),
      ...productMappings
        .filter((mapping) => mapping.status === 'OTHER_SOURCE')
        .map((mapping) => `OTHER_SOURCE_RULE:${mapping.ruleId}`),
    ];
    return {
      productId: product.productId,
      name: product.name,
      sourceStatus: product.status,
      providerProductId,
      ruleCount: productMappings.length,
      mappings: productMappings,
      blockers,
      readyToPublish: blockers.length === 0 && productMappings.every((mapping) => mapping.status === 'DIRECT'),
    };
  });
  const count = (status: LegacyRuleMappingStatus): number =>
    mappings.filter((mapping) => mapping.status === status).length;
  return {
    schemaVersion: 1,
    source: inventory.repo,
    generatedAt,
    summary: {
      products: products.length,
      rules: mappings.length,
      direct: count('DIRECT'),
      partial: count('PARTIAL'),
      otherSource: count('OTHER_SOURCE'),
      unmapped: count('UNMAPPED'),
      readyProducts: products.filter((product) => product.readyToPublish).length,
    },
    products,
    conflicts: inventory.conflicts.length,
    gaps: inventory.gaps.length,
  };
}

export function renderLegacyRuleImportPlanMarkdown(plan: LegacyRuleImportPlan): string {
  const lines = [
    '# План переноса действующих правил LK1 в модель ЦУП',
    '',
    `Источник: ${plan.source.url}@${plan.source.sha} (${plan.source.date}); сформировано ${plan.generatedAt}.`,
    '',
    `Продуктов: ${plan.summary.products}; правил: ${plan.summary.rules}; DIRECT: ${plan.summary.direct}; PARTIAL: ${plan.summary.partial}; OTHER_SOURCE: ${plan.summary.otherSource}; UNMAPPED: ${plan.summary.unmapped}; готовы к публикации: ${plan.summary.readyProducts}.`,
    '',
    'Ни один продукт не публикуется автоматически: план фиксирует, какие правила переносятся напрямую, какие требуют продуктового решения и какие принадлежат LK2 level-правилам.',
    '',
    '| Продукт | Статус LK1 | Правил | Provider product id | Блокеры | Готов |',
    '| --- | --- | ---: | --- | --- | --- |',
    ...plan.products.map((product) =>
      `| ${product.name} (\`${product.productId}\`) | ${product.sourceStatus} | ${product.ruleCount} | ${product.providerProductId ?? '—'} | ${product.blockers.length} | ${product.readyToPublish ? 'да' : 'нет'} |`
    ),
    '',
  ];
  for (const product of plan.products) {
    lines.push(`## ${product.name}`, '');
    for (const mapping of product.mappings) {
      lines.push(
        `- \`${mapping.ruleId}\` — ${mapping.ruleGroup} → ${mapping.cupTarget} (${mapping.status}): ${mapping.reason}`
      );
    }
    if (product.blockers.length > 0) {
      lines.push('', `Блокеры: ${product.blockers.join(', ')}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}
