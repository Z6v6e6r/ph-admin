import { Injectable } from '@nestjs/common';
import { PNG } from 'pngjs';
import qrcode = require('qrcode-generator');

const PNG_SIZE = 1024;
const QUIET_ZONE_MODULES = 4;
const ERROR_CORRECTION: 'M' = 'M';

/**
 * Renders the permanent short link as a plain black-on-white QR code.
 * The image never contains the current destination, personal data or tokens.
 *
 * Encoding is local (qrcode-generator); PNG rasterization uses the already
 * audited pngjs runtime dependency. No external QR service is called.
 */
@Injectable()
export class QrCodeImageService {
  async renderPng(shortUrl: string): Promise<Buffer> {
    const qr = this.encode(shortUrl);
    const moduleCount = qr.getModuleCount();
    const totalModules = moduleCount + QUIET_ZONE_MODULES * 2;
    const scale = Math.max(1, Math.floor(PNG_SIZE / totalModules));
    const contentSize = totalModules * scale;
    const offset = Math.floor((PNG_SIZE - contentSize) / 2);
    const png = new PNG({ width: PNG_SIZE, height: PNG_SIZE });
    for (let index = 0; index < png.data.length; index += 4) {
      png.data[index] = 255;
      png.data[index + 1] = 255;
      png.data[index + 2] = 255;
      png.data[index + 3] = 255;
    }
    for (let row = 0; row < moduleCount; row += 1) {
      for (let column = 0; column < moduleCount; column += 1) {
        if (!qr.isDark(row, column)) continue;
        const startX = offset + (column + QUIET_ZONE_MODULES) * scale;
        const startY = offset + (row + QUIET_ZONE_MODULES) * scale;
        for (let y = 0; y < scale; y += 1) {
          const pixelY = startY + y;
          if (pixelY < 0 || pixelY >= PNG_SIZE) continue;
          for (let x = 0; x < scale; x += 1) {
            const pixelX = startX + x;
            if (pixelX < 0 || pixelX >= PNG_SIZE) continue;
            const index = (pixelY * PNG_SIZE + pixelX) * 4;
            png.data[index] = 0;
            png.data[index + 1] = 0;
            png.data[index + 2] = 0;
            png.data[index + 3] = 255;
          }
        }
      }
    }
    return PNG.sync.write(png, { colorType: 6 });
  }

  async renderSvg(shortUrl: string): Promise<string> {
    const qr = this.encode(shortUrl);
    const moduleCount = qr.getModuleCount();
    const totalModules = moduleCount + QUIET_ZONE_MODULES * 2;
    const modules: string[] = [];
    for (let row = 0; row < moduleCount; row += 1) {
      for (let column = 0; column < moduleCount; column += 1) {
        if (!qr.isDark(row, column)) continue;
        modules.push(
          `<rect x="${column + QUIET_ZONE_MODULES}" y="${row + QUIET_ZONE_MODULES}" width="1" height="1"/>`
        );
      }
    }
    return [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${PNG_SIZE}" height="${PNG_SIZE}" viewBox="0 0 ${totalModules} ${totalModules}" shape-rendering="crispEdges">`,
      `<rect width="${totalModules}" height="${totalModules}" fill="#ffffff"/>`,
      '<g fill="#000000">',
      modules.join(''),
      '</g>',
      '</svg>',
      ''
    ].join('');
  }

  private encode(shortUrl: string): QRCodeInstance {
    const qr = qrcode(0, ERROR_CORRECTION);
    qr.addData(shortUrl, 'Byte');
    qr.make();
    return qr;
  }
}

type QRCodeInstance = ReturnType<typeof qrcode>;
