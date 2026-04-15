import { Module } from '@nestjs/common';
import { AdvertisingController } from './advertising.controller';
import { AdvertisingService } from './advertising.service';

@Module({
  controllers: [AdvertisingController],
  providers: [AdvertisingService]
})
export class AdvertisingModule {}
