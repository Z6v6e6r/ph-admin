import { Controller, Get, Res } from '@nestjs/common';
import { Response } from 'express';
import { join } from 'path';

@Controller('client-script')
export class ClientScriptController {
  @Get('admin-panel.js')
  streamAdminPanel(@Res() response: Response): void {
    const filePath = join(process.cwd(), 'client-sdk', 'phab-admin-panel.js');
    response.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    response.sendFile(filePath);
  }

  @Get('admin-panel.download.js')
  downloadAdminPanel(@Res() response: Response): void {
    const filePath = join(process.cwd(), 'client-sdk', 'phab-admin-panel.js');
    response.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    response.setHeader(
      'Content-Disposition',
      'attachment; filename="phab-admin-panel.js"'
    );
    response.sendFile(filePath);
  }

  @Get('messenger-widget.js')
  streamScript(@Res() response: Response): void {
    const filePath = join(process.cwd(), 'client-sdk', 'phab-client-messenger.js');
    response.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    response.sendFile(filePath);
  }

  @Get('messenger-widget.download.js')
  downloadScript(@Res() response: Response): void {
    const filePath = join(process.cwd(), 'client-sdk', 'phab-client-messenger.js');
    response.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    response.setHeader(
      'Content-Disposition',
      'attachment; filename="phab-client-messenger.js"'
    );
    response.sendFile(filePath);
  }
}
