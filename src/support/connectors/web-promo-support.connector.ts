import { Injectable } from '@nestjs/common';
import { SupportConnectorRoute } from '../support.types';
import { WebSupportConnectorAdapter } from './web-support.connector';

@Injectable()
export class WebPromoSupportConnectorAdapter extends WebSupportConnectorAdapter {
  readonly route = SupportConnectorRoute.PROMO_WEB_MESSENGER;
  readonly aliases = [
    'PROMO_WEB_MESSENGER',
    'PROMO_WEB',
    'WEB_PROMO',
    'PROMO_WIDGET',
    'SITE_WIDGET',
    'PROMO'
  ];
}
