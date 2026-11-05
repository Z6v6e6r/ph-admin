import { Injectable } from '@nestjs/common';
import * as QRCode from 'qrcode';

const PNG_SIZE = 1024;
const QUIET_ZONE_MODULES = 4;
const ERROR_CORRECTION = 'M' as const;

/**
 * Renders the permanent short link as a plain black-on-white QR code.
 * The image never contains the current destination, personal data or tokens.
 */
@Injectable()
export class QrCodeImageService {
  async renderPng(shortUrl: string): Promise<Buffer> {
    return QRCode.toBuffer(shortUrl, {
      type: 'png',
      width: PNG_SIZE,
      margin: QUIET_ZONE_MODULES,
      errorCorrectionLevel: ERROR_CORRECTION,
      color: { dark: '#000000ff', light: '#ffffffff' }
    });
  }

  async renderSvg(shortUrl: string): Promise<string> {
    return QRCode.toString(shortUrl, {
      type: 'svg',
      width: PNG_SIZE,
      margin: QUIET_ZONE_MODULES,
      errorCorrectionLevel: ERROR_CORRECTION,
      color: { dark: '#000000', light: '#ffffff' }
    });
  }
}
