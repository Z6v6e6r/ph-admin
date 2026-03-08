import { Controller, Get, Res } from '@nestjs/common';
import { Response } from 'express';
import { existsSync } from 'fs';
import { join } from 'path';

@Controller('client-script')
export class ClientScriptController {
  private resolveScriptFile(fileName: string): string {
    const candidates = [
      join(process.cwd(), 'client-sdk', fileName),
      join(process.cwd(), 'dist', 'client-sdk', fileName),
      join(process.cwd(), fileName)
    ];

    const found = candidates.find((path) => existsSync(path));
    if (found) {
      return found;
    }

    return candidates[0];
  }

  @Get('admin-panel.js')
  streamAdminPanel(@Res() response: Response): void {
    const filePath = this.resolveScriptFile('phab-admin-panel.js');
    response.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    response.sendFile(filePath);
  }

  @Get('admin-panel.download.js')
  downloadAdminPanel(@Res() response: Response): void {
    const filePath = this.resolveScriptFile('phab-admin-panel.js');
    response.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    response.setHeader(
      'Content-Disposition',
      'attachment; filename="phab-admin-panel.js"'
    );
    response.sendFile(filePath);
  }

  @Get('messenger-widget.js')
  streamScript(@Res() response: Response): void {
    const filePath = this.resolveScriptFile('phab-client-messenger.js');
    response.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    response.sendFile(filePath);
  }

  @Get('messenger-widget.download.js')
  downloadScript(@Res() response: Response): void {
    const filePath = this.resolveScriptFile('phab-client-messenger.js');
    response.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    response.setHeader(
      'Content-Disposition',
      'attachment; filename="phab-client-messenger.js"'
    );
    response.sendFile(filePath);
  }
}
