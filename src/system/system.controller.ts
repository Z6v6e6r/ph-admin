import { Controller, Get } from '@nestjs/common';

@Controller()
export class SystemController {
  @Get()
  root(): {
    service: string;
    status: string;
    timestamp: string;
    endpoints: string[];
  } {
    return {
      service: 'ph-admin-backend',
      status: 'ok',
      timestamp: new Date().toISOString(),
      endpoints: [
        '/api/health',
        '/api/auth/me',
        '/api/messenger/threads',
        '/api/ui/admin'
      ]
    };
  }

  @Get('health')
  health(): { status: string; timestamp: string } {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }
}
