// One bounded budget per source process. No request/identity keys or timers in this pure helper.
export function createDiagnosticBudget(limit = 600) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 6000) throw new Error('DIAGNOSTIC_BUDGET_INVALID');
  let start: number | null = null, details = 0;
  const counts = new Map<string, number>();
  const kinds = ['stage', 'request_terminal', 'operation_result', 'client_error', 'audit', 'transport'];
  return {
    admit(now: number, kind: string) {
      if (start === null || now - start >= 60000 || now < start) { start = now; details = 0; }
      if (++details <= limit) return true;
      const bucket = kinds.includes(kind) ? kind : 'stage';
      counts.set(bucket, (counts.get(bucket) || 0) + 1);
      return false;
    },
    drain() { const result = [...counts].map(([kind, count]) => ({ kind, count })); counts.clear(); return result; },
  };
}
