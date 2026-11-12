import { Collection, Document } from 'mongodb';
import { createHash } from 'node:crypto';
import { ServiceUnavailableException } from '@nestjs/common';
import { ConflictException } from '@nestjs/common';
import { maxOutboxMode } from '../common/release-capabilities';
import { SupportOutboxCommand } from './support.types';

export interface MaxGeneration {
  generation: string;
  after: string;
}
export interface MaxOrigin {
  kind: 'STAFF_REPLY' | 'INBOUND_AUTO_REPLY';
  id: string;
  at: string;
}
const canonical = (value: unknown): value is string => typeof value === 'string'
  && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const reject = () => new ConflictException({ code: 'MAX_GENERATION_NOT_ADMITTED' });

/** Public operation identity, never a token. Missing paired configuration fails closed. */
export function maxGeneration(environment: NodeJS.ProcessEnv = process.env): MaxGeneration | undefined {
  const generation = environment.SUPPORT_MAX_GENERATION;
  const after = environment.SUPPORT_MAX_GENERATION_AFTER;
  if (generation === undefined && after === undefined) return undefined;
  if (!generation || !/^[a-f0-9-]{36}$/.test(generation) || !canonical(after)
    || maxOutboxMode(environment) !== 'legacy' || !String(environment.SUPPORT_INTEGRATION_TOKEN ?? '').trim()) throw new Error('MAX_GENERATION_CONFIG_INVALID');
  return { generation, after };
}

export function maxOriginAdmitted(origin: unknown, config = maxGeneration(), now = Date.now()): origin is MaxOrigin {
  if (!config) return true;
  if (!origin || typeof origin !== 'object') return false;
  const value = origin as Partial<MaxOrigin>;
  return (value.kind === 'STAFF_REPLY' || value.kind === 'INBOUND_AUTO_REPLY')
    && typeof value.id === 'string' && value.id.length > 0 && value.id.length <= 200
    && canonical(value.at) && value.at > config.after && Date.parse(value.at) <= now + 5000;
}

/** Called only by fresh server-side admission; never upgrades cached/hydrated rows. */
export function admitMaxGeneration(command: SupportOutboxCommand, origin: MaxOrigin | undefined,
  config = maxGeneration(), now = Date.now()): SupportOutboxCommand {
  if (!config) return command;
  if (!maxOriginAdmitted(origin, config, now) || command.status !== 'PENDING' || command.attempts !== 0) throw reject();
  return { ...command, meta: { ...command.meta, maxGenerationAdmission: {
    schema: 1, generation: config.generation, after: config.after, origin: { ...origin }
  } } };
}

/** Every claim checks this, including durable claims reached outside the live Map. */
export function maxGenerationAdmitted(command: SupportOutboxCommand, config = maxGeneration(), now = Date.now()): boolean {
  if (!config) return true;
  const marker = command.meta?.maxGenerationAdmission as { schema?: unknown; generation?: unknown; after?: unknown; origin?: unknown } | undefined;
  return marker?.schema === 1 && marker.generation === config.generation && marker.after === config.after
    && maxOriginAdmitted(marker.origin, config, now);
}
export function assertMaxGeneration(command: SupportOutboxCommand): void {
  if (!maxGenerationAdmitted(command)) throw reject();
}

/** Built-in _id uniqueness is sufficient; provisioning is an explicit offline operation. */
export const MAX_GENERATION_CONTROL_ID = 'max-new-only-v1';
export const maxGenerationCollectionName = (outbox: string): string => `${outbox}_generation_control`;

export async function assertMaxGenerationControl(control: Collection<Document> | undefined,
  config = maxGeneration()): Promise<void> {
  if (!control) {
    if (config) throw new ServiceUnavailableException({ code: 'MAX_GENERATION_CONTROL_REQUIRED' });
    return;
  }
  let row: Document | null;
  try {
    row = await control.findOne({ _id: MAX_GENERATION_CONTROL_ID } as Document,
      { readConcern: { level: 'majority' }, readPreference: 'primary', timeoutMS: 5000 });
  } catch { throw new ServiceUnavailableException({ code: 'MAX_GENERATION_READ_UNKNOWN' }); }
  if (!row && !config) return;
  if (!row || !config || row.schema !== 1 || row.generation !== config.generation
    || row.after !== config.after || row.state !== 'OPEN') {
    throw new ServiceUnavailableException({ code: 'MAX_GENERATION_CLOSED' });
  }
}

/** One irreversible processing admission, before ingress side effects. Unknown ACK never replays. */
export async function admitMaxIngress(control: Collection<Document>, connector: string, origin: MaxOrigin,
  config = maxGeneration()): Promise<string | undefined> {
  await assertMaxGenerationControl(control, config);
  if (!config) return;
  if (!maxOriginAdmitted(origin, config)) throw reject();
  const key = createHash('sha256').update(JSON.stringify([connector, origin.id])).digest('hex');
  try {
    await control.insertOne({ _id: `ingress:${key}`, schema: 1, generation: config.generation,
      originAt: origin.at, admittedAt: new Date().toISOString() } as Document,
    { writeConcern: { w: 'majority', j: true }, timeoutMS: 5000 });
    return `ingress:${key}`;
  } catch {
    // Duplicate, timeout and lost write ACK all hold the event. No fresh ID or callback retry.
    throw new ConflictException({ code: 'MAX_INGRESS_ALREADY_ADMITTED_OR_UNKNOWN' });
  }
}

/** Consume one pre-admission exactly once before business effects. No automatic handler retry. */
export async function consumeMaxIngress(control: Collection<Document>, connector: string, origin: MaxOrigin,
  ticket: unknown, config = maxGeneration()): Promise<void> {
  if (!config) return;
  await assertMaxGenerationControl(control, config);
  const expected = 'ingress:' + createHash('sha256').update(JSON.stringify([connector, origin.id])).digest('hex');
  if (ticket !== expected || !maxOriginAdmitted(origin, config)) throw reject();
  let row: Document | null;
  try {
    row = await control.findOneAndUpdate({ _id: expected, generation: config.generation,
      originAt: origin.at, processingStartedAt: { $exists: false } } as Document,
    { $set: { processingStartedAt: new Date().toISOString() } },
    { returnDocument: 'after', includeResultMetadata: false, writeConcern: { w: 'majority', j: true }, timeoutMS: 5000 });
  } catch { throw new ServiceUnavailableException({ code: 'MAX_INGRESS_CONSUME_UNKNOWN' }); }
  if (!row) throw reject();
}
