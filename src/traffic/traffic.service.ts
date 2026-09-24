import { BadRequestException, ConflictException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { promises as fs } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { isIP } from 'node:net';
import { randomUUID } from 'node:crypto';

export const PROTECTED_IPS = ['188.127.235.140'];
export interface TrafficRule {
  id: string; ip: string; reason: string; expiresAt: string; createdAt: string; actorId: string;
}
export interface TrafficPolicy {
  version: 1; revision: number; rules: TrafficRule[];
  audit: { at: string; actorId: string; action: string; ip: string; revision: number; reason: string }[];
}
export function normalizeIp(value: unknown): string {
  if (typeof value !== 'string' || value !== value.trim() || value.includes('%') || !isIP(value)) {
    throw new BadRequestException('Укажите один IPv4 или IPv6 адрес, без сети и порта');
  }
  let ip = isIP(value) === 6 ? new URL(`http://[${value}]/`).hostname.slice(1, -1) : value;
  const mapped = ip.match(/^::ffff:([0-9a-f]+):([0-9a-f]+)$/i);
  if (mapped) {
    const n = parseInt(mapped[1], 16) * 65536 + parseInt(mapped[2], 16);
    ip = [24, 16, 8, 0].map((shift) => (n >>> shift) & 255).join('.');
  }
  return ip;
}
export function isProtectedIp(ip: string): boolean {
  return PROTECTED_IPS.includes(ip) || ip === '::' || ip === '::1' ||
    /^(fc|fd|fe[89ab])/i.test(ip) ||
    /^(0|10|127)\./.test(ip) || /^192\.168\./.test(ip) ||
    /^169\.254\./.test(ip) || /^172\.(1[6-9]|2\d|3[01])\./.test(ip);
}
export function validDay(day: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(Date.parse(day)) &&
    new Date(day).toISOString().slice(0, 10) === day;
}

@Injectable()
export class TrafficService {
  private config() {
    const policy = process.env.TRAFFIC_POLICY_FILE;
    const reports = process.env.TRAFFIC_REPORT_DIR;
    const enabled = process.env.TRAFFIC_ADMIN_ENABLED === 'true';
    if (enabled && (!policy || !reports || !isAbsolute(policy) || !isAbsolute(reports))) {
      throw new ServiceUnavailableException('Не настроено хранилище карантина');
    }
    return { enabled, policy: policy || '', reports: reports || '' };
  }

  private async readJson(path: string, limit = 2_000_000): Promise<any | undefined> {
    try {
      if ((await fs.stat(path)).size > limit) throw new Error('oversize');
      return JSON.parse(await fs.readFile(path, 'utf8'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw new ServiceUnavailableException('Хранилище недоступно или повреждено');
    }
  }

  private async policy(path: string): Promise<TrafficPolicy> {
    const value = await this.readJson(path);
    if (value === undefined) throw new ServiceUnavailableException('Политика карантина не инициализирована');
    if (value.version !== 1 || !Number.isSafeInteger(value.revision) || value.revision < 0 ||
        !Array.isArray(value.rules) || value.rules.length > 1000 || !Array.isArray(value.audit)) {
      throw new ServiceUnavailableException('Повреждена политика карантина');
    }
    const seen = new Set<string>();
    for (const rule of value.rules) {
      try {
        if (normalizeIp(rule.ip) !== rule.ip || isProtectedIp(rule.ip) || seen.has(rule.ip) ||
            typeof rule.id !== 'string' || typeof rule.reason !== 'string' ||
            !Number.isFinite(Date.parse(rule.expiresAt))) throw new Error('invalid');
        seen.add(rule.ip);
      } catch {
        throw new ServiceUnavailableException('Повреждена политика карантина');
      }
    }
    return value;
  }

  async overview(day: string) {
    if (!validDay(day)) throw new BadRequestException('Дата должна иметь формат YYYY-MM-DD');
    const cfg = this.config();
    if (!cfg.enabled) return { enabled: false, protectedIps: PROTECTED_IPS };
    const [policy, edge, report] = await Promise.all([
      this.policy(cfg.policy), this.readJson(join(cfg.reports, 'edge-status.json')),
      this.readJson(join(cfg.reports, `${day}.json`))
    ]);
    const fresh = edge && Number.isFinite(Date.parse(edge.checkedAt)) &&
      Date.now() - Date.parse(edge.checkedAt) < 180_000;
    return { enabled: true, scope: 'public-schedule', protectedIps: PROTECTED_IPS,
      policy, edge: edge || null, applied: Boolean(fresh && !edge.error && edge.appliedRevision === policy.revision),
      report: report || null, day, timezone: 'Europe/Moscow' };
  }

  async mutate(body: unknown, actorId: string) {
    const cfg = this.config();
    if (!cfg.enabled) throw new ServiceUnavailableException('Карантин ещё не включён');
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new BadRequestException('Некорректная операция');
    const dto = body as Record<string, unknown>;
    if (!['add', 'remove'].includes(String(dto.action)) || !Number.isSafeInteger(dto.revision)) {
      throw new BadRequestException('Нужны action и revision');
    }
    const ip = normalizeIp(dto.ip);
    if (isProtectedIp(ip)) throw new BadRequestException('Разрешённый или служебный адрес нельзя поместить в карантин');
    const reason = typeof dto.reason === 'string' ? dto.reason.trim() : '';
    if (!reason || reason.length > 300 || /[\x00-\x1f]/.test(reason)) throw new BadRequestException('Укажите причину, до 300 символов');
    const expiresAt = typeof dto.expiresAt === 'string' ? dto.expiresAt : '';
    if (dto.action === 'add' && (!Number.isFinite(Date.parse(expiresAt)) ||
        Date.parse(expiresAt) < Date.now() + 60_000 || Date.parse(expiresAt) > Date.now() + 90 * 86_400_000)) {
      throw new BadRequestException('Срок карантина: от минуты до 90 дней');
    }
    // Cross-process exclusion plus revision check; a crash leaves a visible lock, never a lost update.
    const lock = cfg.policy + '.lock';
    try { await fs.mkdir(lock, { mode: 0o700 }); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new ConflictException('Список меняется, обновите страницу');
      throw new ServiceUnavailableException('Хранилище карантина недоступно');
    }
    try {
      const policy = await this.policy(cfg.policy);
      if (dto.revision !== policy.revision) throw new ConflictException('Список уже изменён, обновите страницу');
      const existing = policy.rules.find((rule) => rule.ip === ip);
      if (dto.action === 'remove' && !existing) throw new ConflictException('Адрес уже снят с карантина');
      if (dto.action === 'add' && !existing && policy.rules.length >= 1000) throw new BadRequestException('Достигнут лимит: 1000 адресов');
      const at = new Date().toISOString();
      policy.rules = policy.rules.filter((rule) => rule.ip !== ip);
      if (dto.action === 'add') policy.rules.push({ id: existing?.id || randomUUID(), ip, reason,
        expiresAt: new Date(expiresAt).toISOString(), createdAt: at, actorId });
      policy.revision += 1;
      policy.audit.push({ at, actorId, action: String(dto.action), ip, revision: policy.revision, reason });
      // Refuse writes before bounded durable audit fills; never silently truncate the change trail.
      if (policy.audit.length > 5000) throw new ServiceUnavailableException('Архивируйте журнал карантина перед изменением списка');
      const serialized = JSON.stringify(policy);
      if (Buffer.byteLength(serialized) > 1_800_000) throw new ServiceUnavailableException('Архивируйте журнал карантина перед изменением списка');
      const temp = cfg.policy + '.' + randomUUID() + '.tmp';
      try {
        const handle = await fs.open(temp, 'wx', 0o640);
        try { await handle.writeFile(serialized); await handle.sync(); }
        finally { await handle.close(); }
        await fs.rename(temp, cfg.policy);
        const directory = await fs.open(dirname(cfg.policy), 'r');
        try { await directory.sync(); } finally { await directory.close(); }
      } catch {
        await fs.unlink(temp).catch(() => undefined);
        throw new ServiceUnavailableException('Не удалось подтвердить сохранение, обновите список');
      }
      return { revision: policy.revision, applied: false };
    } finally { await fs.rmdir(lock); }
  }
}
