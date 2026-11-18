import { CallHandler, ExecutionContext, Logger, NestInterceptor, ServiceUnavailableException } from '@nestjs/common';
import type { RequestHandler } from 'express';
import { defer, finalize, Observable } from 'rxjs';

const shutdownMessage = 'Application is shutting down';

export class HttpShutdownDrain implements NestInterceptor {
  private accepting = true;
  private readonly handlers = new Set<Promise<void>>();

  readonly middleware: RequestHandler = (_request, response, next) => {
    if (this.accepting) {
      next();
      return;
    }
    response.setHeader('Connection', 'close');
    response.status(503).json({ statusCode: 503, message: shutdownMessage });
  };

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    return defer(() => {
      if (!this.accepting) throw new ServiceUnavailableException(shutdownMessage);

      let complete!: () => void;
      const finished = new Promise<void>(resolve => { complete = resolve; });
      this.handlers.add(finished);
      // A client disconnect can close the response before the handler finishes.
      return defer(() => next.handle()).pipe(finalize(() => {
        this.handlers.delete(finished);
        complete();
      }));
    });
  }

  drain(): Promise<void> {
    this.accepting = false;
    return Promise.all(this.handlers).then(() => undefined);
  }
}

export function installShutdownHandlers(shutdown: () => Promise<void>): void {
  const logger = new Logger('GracefulShutdown');
  let stopping = false;
  const stop = (): void => {
    if (stopping) return;
    stopping = true;
    void shutdown().catch(() => {
      process.exitCode = 1;
      logger.error('CUP_GRACEFUL_SHUTDOWN_FAILED');
    });
  };

  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}
