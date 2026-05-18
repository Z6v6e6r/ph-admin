import * as assert from 'node:assert/strict';
import { VivaAdminService } from '../src/integrations/viva/viva-admin.service';

async function main(): Promise<void> {
  process.env.VIVA_ADMIN_API_TOKEN = 'admin-token';
  process.env.VIVA_ADMIN_API_BASE_URL = 'https://api.vivacrm.ru';
  process.env.VIVA_BOOKING_PAYMENT_PRODUCT_IDS = '';
  process.env.VIVA_BOOKING_PAYMENT_PRODUCT_NAME = '';

  const service = new VivaAdminService();
  const originalFetch = globalThis.fetch;
  const transactionBodies: Array<Record<string, unknown>> = [];

  globalThis.fetch = (async (requestUrl: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(requestUrl));
    const method = init?.method ?? 'GET';
    const headers = init?.headers as Record<string, string> | undefined;
    assert.equal(headers?.Authorization, 'Bearer admin-token');

    if (method === 'GET' && url.pathname === '/api/v2/search/clients') {
      assert.ok(
        ['+79123456789', '79123456789', '89123456789', '+89123456789', '9123456789']
          .includes(String(url.searchParams.get('q')))
      );
      return {
        ok: true,
        status: 200,
        json: async () => ({
          content: [
            {
              id: 'client-1',
              phone: '+79123456789',
              name: 'Игрок'
            }
          ]
        })
      } as Response;
    }

    if (method === 'POST' && url.pathname === '/api/v1/products/available/by-booking') {
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      assert.deepEqual(body, {
        bookingIds: ['booking-1'],
        clientId: 'client-1',
        studioId: 'studio-1'
      });
      return {
        ok: true,
        status: 200,
        json: async () => [
          {
            id: 'quarter-product',
            name: '1/4 игры',
            cost: 1000000,
            productType: 'SERVICE',
            pricingDetails: [
              {
                clientBookingId: 'booking-1',
                details: [
                  {
                    name: '1/4 игры',
                    value: 10000,
                    pricingTarget: 'PRODUCT'
                  }
                ],
                warnings: [],
                containsTrainer: false
              }
            ]
          },
          {
            id: 'subscription-product',
            name: 'Лето.Падел.Дружба',
            cost: 980000,
            productType: 'SUBSCRIPTION'
          }
        ]
      } as Response;
    }

    if (method === 'GET' && url.pathname === '/api/v1/contracts/clients/client-1') {
      assert.equal(url.searchParams.get('productIds'), 'quarter-product');
      return {
        ok: true,
        status: 200,
        json: async () => []
      } as Response;
    }

    if (method === 'POST' && url.pathname === '/api/v1/transactions') {
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      transactionBodies.push(body);
      return {
        ok: true,
        status: 201,
        json: async () => ({
          id: 'transaction-1',
          status: 'WAITING',
          toPay: 250000,
          discount: 750000,
          discountReason: 'Split booking 2026-05-20 07:00',
          paymentDueDate: '2026-05-20T07:15:00+03:00',
          cardPaymentInfo: {
            paymentId: 'payment-1',
            paymentUrl: 'https://pay.example/split'
          }
        })
      } as Response;
    }

    throw new Error(`Unexpected request: ${method} ${url.toString()}`);
  }) as typeof fetch;

  try {
    const result = await service.createBookingPaymentCheckout({
      clientPhone: '79123456789',
      clientId: 'client-1',
      studioId: 'studio-1',
      bookingIds: ['booking-1'],
      paymentMethod: 'SMS',
      amountMinor: 250000,
      baseAmountMinor: 1000000,
      discountAmountMinor: 750000,
      discountReason: 'Split booking 2026-05-20 07:00',
      productName: '1/4 игры'
    });

    assert.equal(transactionBodies.length, 1);
    assert.equal(transactionBodies[0]?.clientPhone, '+79123456789');
    assert.equal(transactionBodies[0]?.paymentMethod, 'SMS');
    assert.equal(transactionBodies[0]?.studioId, 'studio-1');
    assert.equal(transactionBodies[0]?.discountReason, 'Split booking 2026-05-20 07:00');
    assert.equal(transactionBodies[0]?.offlineTillId, null);
    assert.equal(transactionBodies[0]?.deposit, 0);
    const products = transactionBodies[0]?.products as Array<Record<string, unknown>>;
    assert.equal(products.length, 1);
    assert.equal(products[0]?.id, 'quarter-product');
    assert.equal(products[0]?.count, 1);
    assert.equal(products[0]?.customAmount, null);
    assert.equal(products[0]?.type, 'SERVICE');
    assert.equal(products[0]?.discount, 750000);
    assert.deepEqual(products[0]?.bookingIds, ['booking-1']);

    assert.equal(result.clientId, 'client-1');
    assert.equal(result.productId, 'quarter-product');
    assert.deepEqual(result.bookingIds, ['booking-1']);
    assert.equal(result.transactionId, 'transaction-1');
    assert.equal(result.paymentUrl, 'https://pay.example/split');
    assert.equal(result.toPayMinor, 250000);
    assert.equal(result.paymentExpiresAt, '2026-05-20T07:15:00+03:00');
  } finally {
    globalThis.fetch = originalFetch;
  }

  console.log('Viva admin booking payment checkout test passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
