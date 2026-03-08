import { Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  TelegramCommandMethod,
  TelegramOutboxCommand
} from './telegram-outbox.types';

@Injectable()
export class TelegramOutboxService {
  private readonly commands = new Map<string, TelegramOutboxCommand>();

  enqueue(
    method: TelegramCommandMethod,
    payload: Record<string, unknown>
  ): TelegramOutboxCommand {
    const now = new Date().toISOString();
    const command: TelegramOutboxCommand = {
      id: randomUUID(),
      method,
      payload,
      status: 'PENDING',
      attempts: 0,
      createdAt: now,
      updatedAt: now
    };

    this.commands.set(command.id, command);
    return command;
  }

  pull(limit = 20, leaseSec = 30): TelegramOutboxCommand[] {
    const now = Date.now();
    const leaseMs = Math.max(5, leaseSec) * 1000;
    const items = Array.from(this.commands.values())
      .filter((item) => {
        if (item.status === 'PENDING') {
          return true;
        }
        if (item.status === 'LEASED' && item.leasedUntil) {
          return Date.parse(item.leasedUntil) < now;
        }
        return false;
      })
      .sort(
        (left, right) =>
          Date.parse(left.createdAt) - Date.parse(right.createdAt)
      )
      .slice(0, Math.max(1, limit));

    const leasedUntil = new Date(now + leaseMs).toISOString();
    const leased: TelegramOutboxCommand[] = [];
    for (const item of items) {
      const updated: TelegramOutboxCommand = {
        ...item,
        status: 'LEASED',
        attempts: item.attempts + 1,
        leasedUntil,
        updatedAt: new Date().toISOString()
      };
      this.commands.set(item.id, updated);
      leased.push(updated);
    }

    return leased;
  }

  ack(commandId: string, providerMessageId?: string): TelegramOutboxCommand {
    const existing = this.commands.get(commandId);
    if (!existing) {
      throw new NotFoundException(`Outbox command ${commandId} not found`);
    }

    const updated: TelegramOutboxCommand = {
      ...existing,
      status: 'ACKED',
      leasedUntil: undefined,
      providerMessageId,
      ackedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    this.commands.set(commandId, updated);
    return updated;
  }

  fail(
    commandId: string,
    error?: string,
    requeue = true
  ): TelegramOutboxCommand {
    const existing = this.commands.get(commandId);
    if (!existing) {
      throw new NotFoundException(`Outbox command ${commandId} not found`);
    }

    const updated: TelegramOutboxCommand = {
      ...existing,
      status: requeue ? 'PENDING' : 'FAILED',
      leasedUntil: undefined,
      error: error?.trim() || existing.error,
      updatedAt: new Date().toISOString()
    };
    this.commands.set(commandId, updated);
    return updated;
  }

  list(limit = 100): TelegramOutboxCommand[] {
    return Array.from(this.commands.values())
      .sort(
        (left, right) =>
          Date.parse(right.createdAt) - Date.parse(left.createdAt)
      )
      .slice(0, Math.max(1, limit));
  }
}
