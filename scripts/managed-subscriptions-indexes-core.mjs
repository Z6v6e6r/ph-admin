function sameIndexDefinition(actual, keys, options) {
  return JSON.stringify(actual?.key) === JSON.stringify(keys)
    && Boolean(actual?.unique) === Boolean(options.unique)
    && Boolean(actual?.sparse) === Boolean(options.sparse);
}

export function classifyMissingSubscriptionIndexes(plan, existingByCollection) {
  const missing = [];
  for (const entry of plan) {
    const [collectionName, keys, options] = entry;
    const actualIndexes = existingByCollection.get(collectionName) ?? [];
    const existing = actualIndexes.find((item) => item.name === options.name);
    if (!existing) {
      missing.push(entry);
      continue;
    }
    if (!sameIndexDefinition(existing, keys, options)) {
      throw new Error(`SUBSCRIPTIONS_INDEX_DRIFT:${collectionName}:${options.name}`);
    }
  }
  return missing;
}

export function uniqueIndexesRequiringDuplicatePreflight(missingPlan) {
  return missingPlan.filter(([, , options]) => options.unique === true);
}
