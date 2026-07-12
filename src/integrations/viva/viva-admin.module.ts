import { Module } from '@nestjs/common';
import { VivaAdminService } from './viva-admin.service';

@Module({
  providers: [VivaAdminService],
  exports: [VivaAdminService]
})
export class VivaAdminModule {}
