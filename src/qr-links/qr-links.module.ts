import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MessengerModule } from '../messenger/messenger.module';
import { generateQrLinkCode } from './qr-link-code';
import { QrCodeImageService } from './qr-code-image.service';
import { QrLinksAdminController, QrLinksPublicController } from './qr-links.controller';
import { QrLinksRepository } from './qr-links.repository';
import {
  QR_CLOCK,
  QR_CODE_GENERATOR,
  QR_TARGET_URL_POLICY,
  QrLinksService
} from './qr-links.service';
import { QrTargetUrlPolicy } from './qr-target-url-policy';

@Module({
  imports: [AuthModule, MessengerModule],
  controllers: [QrLinksAdminController, QrLinksPublicController],
  providers: [
    QrLinksRepository,
    QrCodeImageService,
    QrLinksService,
    {
      provide: QR_TARGET_URL_POLICY,
      useFactory: () => new QrTargetUrlPolicy()
    },
    { provide: QR_CODE_GENERATOR, useValue: generateQrLinkCode },
    { provide: QR_CLOCK, useFactory: () => () => new Date() }
  ]
})
export class QrLinksModule {}
