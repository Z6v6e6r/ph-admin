import { createApplication } from './bootstrap';

async function bootstrap(): Promise<void> {
  const app = await createApplication();

  const rawPort = Number(process.env.PORT ?? 3000);
  const port = Number.isFinite(rawPort) && rawPort > 0 ? rawPort : 3000;
  const host = String(process.env.HOST ?? '0.0.0.0').trim() || '0.0.0.0';
  await app.listen(port, host);
}

bootstrap();
