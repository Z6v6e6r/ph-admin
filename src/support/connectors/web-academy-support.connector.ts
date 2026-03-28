import { Injectable } from '@nestjs/common';
import { SupportConnectorRoute } from '../support.types';
import { WebSupportConnectorAdapter } from './web-support.connector';

@Injectable()
export class WebAcademySupportConnectorAdapter extends WebSupportConnectorAdapter {
  readonly route = SupportConnectorRoute.LK_ACADEMY_WEB_MESSENGER;
  readonly aliases = [
    'LK_ACADEMY_WEB_MESSENGER',
    'LK_ACADEMY',
    'ACADEMY_WEB',
    'ACADEMY_LK',
    'AF_LK',
    'AB_LK'
  ];
}
