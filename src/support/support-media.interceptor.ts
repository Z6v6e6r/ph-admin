import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { mergeMap, Observable } from 'rxjs';
import { SupportMediaService } from './support-media.service';

@Injectable()
export class SupportMediaInterceptor implements NestInterceptor {
  constructor(private readonly media: SupportMediaService) {}
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    context.switchToHttp().getResponse().setHeader('Cache-Control', 'private, no-store');
    // Integration receipts have an immutable (type,url) binding checked against Mongo by the
    // existing MAX receiver. The additional server-owned mediaRef is independent of that binding.
    if (context.getHandler().name === 'ingestEvent') return next.handle();
    return next.handle().pipe(mergeMap(value => this.media.present(value)));
  }
}
