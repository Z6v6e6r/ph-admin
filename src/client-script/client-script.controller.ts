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
    response.setHeader('Cache-Control', 'no-store, max-age=0');
    response.sendFile(filePath);
  }

  @Get('admin-panel.download.js')
  downloadAdminPanel(@Res() response: Response): void {
    const filePath = this.resolveScriptFile('phab-admin-panel.js');
    response.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store, max-age=0');
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
    response.setHeader('Cache-Control', 'no-store, max-age=0');
    response.sendFile(filePath);
  }

  @Get('messenger-widget.download.js')
  downloadScript(@Res() response: Response): void {
    const filePath = this.resolveScriptFile('phab-client-messenger.js');
    response.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store, max-age=0');
    response.setHeader(
      'Content-Disposition',
      'attachment; filename="phab-client-messenger.js"'
    );
    response.sendFile(filePath);
  }

  @Get('messenger-push-sw.js')
  streamMessengerPushServiceWorker(@Res() response: Response): void {
    const filePath = this.resolveScriptFile('phab-messenger-push-sw.js');
    response.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store, max-age=0');
    response.setHeader('Service-Worker-Allowed', '/');
    response.sendFile(filePath);
  }

  @Get('communities-showcase.js')
  streamCommunitiesShowcase(@Res() response: Response): void {
    const filePath = this.resolveScriptFile('phab-communities-showcase.js');
    response.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store, max-age=0');
    response.sendFile(filePath);
  }

  @Get('communities-showcase.download.js')
  downloadCommunitiesShowcase(@Res() response: Response): void {
    const filePath = this.resolveScriptFile('phab-communities-showcase.js');
    response.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store, max-age=0');
    response.setHeader(
      'Content-Disposition',
      'attachment; filename="phab-communities-showcase.js"'
    );
    response.sendFile(filePath);
  }

  @Get('community-feed.js')
  streamCommunityFeed(@Res() response: Response): void {
    const filePath = this.resolveScriptFile('phab-community-feed.js');
    response.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store, max-age=0');
    response.sendFile(filePath);
  }

  @Get('community-feed.download.js')
  downloadCommunityFeed(@Res() response: Response): void {
    const filePath = this.resolveScriptFile('phab-community-feed.js');
    response.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store, max-age=0');
    response.setHeader(
      'Content-Disposition',
      'attachment; filename="phab-community-feed.js"'
    );
    response.sendFile(filePath);
  }
}
