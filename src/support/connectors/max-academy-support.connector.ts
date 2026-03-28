import { Injectable } from '@nestjs/common';
import { SupportConnectorRoute } from '../support.types';
import { MaxSupportConnectorAdapter } from './max-support.connector';

@Injectable()
export class MaxAcademySupportConnectorAdapter extends MaxSupportConnectorAdapter {
  readonly route = SupportConnectorRoute.MAX_ACADEMY_BOT;
  readonly aliases = [
    'MAX_ACADEMY_BOT',
    'MAX_ACADEMY',
    'ACADEMY_MAX_BOT',
    'AF_MAX_BOT',
    'AB_MAX_BOT'
  ];
}
