import { createApplication } from './bootstrap';
import { HttpShutdownDrain, installShutdownHandlers } from './common/graceful-shutdown';
import { releaseMaintenanceEnabled } from './common/release-maintenance';

async function bootstrap(): Promise<void> {
  const shutdownDrain = new HttpShutdownDrain();
  const app = await createApplication(shutdownDrain);
  const maintenance = releaseMaintenanceEnabled();
  const support = maintenance ? undefined : app.get((await import('./support/support.service')).SupportService);
  const messenger = maintenance ? undefined : app.get((await import('./messenger/messenger.service')).MessengerService);
  const supportPersistence = maintenance ? undefined
    : app.get((await import('./support/support-persistence.service')).SupportPersistenceService);
  const messengerPersistence = maintenance ? undefined
    : app.get((await import('./messenger/messenger-persistence.service')).MessengerPersistenceService);

  const rawPort = Number(process.env.PORT ?? 3000);
  const port = Number.isFinite(rawPort) && rawPort > 0 ? rawPort : 3000;
  const host = String(process.env.HOST ?? '0.0.0.0').trim() || '0.0.0.0';
  await app.listen(port, host);
  installShutdownHandlers(async () => {
    const drained = shutdownDrain.drain();
    messenger?.stopScheduledWork();
    await Promise.all([drained, support?.stopScheduledWork()]);
    await app.close();
    if (supportPersistence?.hasUnconfirmedWrites || messengerPersistence?.hasUnconfirmedWrites) {
      throw new Error('CUP_HISTORY_WRITES_UNCONFIRMED');
    }
  });
}

bootstrap();
