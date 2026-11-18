import { ServiceUnavailableException } from '@nestjs/common';

/** Tracks writes whose callers do not await the persistence result. */
export class DeferredWrites {
  private readonly pending = new Set<Promise<void>>();
  private closing = false;
  private failed = false;

  get hasUnconfirmedWrites(): boolean {
    return this.failed;
  }

  start(enabled: boolean, task: () => Promise<void>, onFailure: (error: unknown) => void): void {
    if (this.closing) throw new ServiceUnavailableException('History persistence is shutting down');
    if (!enabled) return;

    const pending = task().catch(error => {
      this.failed = true;
      onFailure(error);
    }).finally(() => this.pending.delete(pending));
    this.pending.add(pending);
  }

  async drain(): Promise<void> {
    this.closing = true;
    await Promise.allSettled(this.pending);
  }
}

export async function waitForAllWrites(writes: ReadonlyArray<Promise<unknown>>): Promise<void> {
  const settled = await Promise.allSettled(writes);
  const failure = settled.find(result => result.status === 'rejected');
  if (failure) throw failure.reason;
}
