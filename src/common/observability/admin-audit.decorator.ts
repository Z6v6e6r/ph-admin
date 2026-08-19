import { SetMetadata } from '@nestjs/common';

export const SKIP_ADMIN_MUTATION_AUDIT_KEY = 'skip-admin-mutation-audit';

/** Marks a POST-like transport as a read-only operation that must not write mutation audit. */
export const SkipAdminMutationAudit = (): ReturnType<typeof SetMetadata> =>
  SetMetadata(SKIP_ADMIN_MUTATION_AUDIT_KEY, true);
