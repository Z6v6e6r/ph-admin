import { Module } from '@nestjs/common';
import { ClientScriptController } from './client-script.controller';

@Module({
  controllers: [ClientScriptController]
})
export class ClientScriptModule {}
