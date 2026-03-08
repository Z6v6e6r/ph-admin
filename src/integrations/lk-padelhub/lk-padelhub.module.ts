import { Module } from '@nestjs/common';
import { LkPadelHubClientService } from './lk-padelhub-client.service';

@Module({
  providers: [LkPadelHubClientService],
  exports: [LkPadelHubClientService]
})
export class LkPadelHubModule {}
