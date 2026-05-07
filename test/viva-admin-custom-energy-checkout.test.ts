import * as assert from 'node:assert/strict';
import { VivaAdminService } from '../src/integrations/viva/viva-admin.service';

async function main(): Promise<void> {
  process.env.VIVA_ADMIN_API_TOKEN = 'admin-token';
  process.env.VIVA_ADMIN_API_BASE_URL = 'https://api.vivacrm.ru';
  process.env.TOURNAMENT_ENERGY_SUBSCRIPTION_IDS = '';

  const service = new VivaAdminService();
  const originalFetch = globalThis.fetch;
  const transactionBodies: Array<Record<string, unknown>> = [];

  globalThis.fetch = (async (requestUrl: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(requestUrl));
    const method = init?.method ?? 'GET';
    const headers = init?.headers as Record<string, string> | undefined;
    assert.equal(headers?.Authorization, 'Bearer admin-token');

    if (method === 'GET' && url.pathname === '/api/v2/search/clients') {
      assert.ok(['+79123456789', '79123456789', '9123456789'].includes(String(url.searchParams.get('q'))));
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

    if (method === 'GET' && url.pathname === '/api/v1/products') {
      assert.equal(url.searchParams.get('name'), 'Энергия т');
      assert.equal(url.searchParams.get('studioId'), 'studio-1');
      assert.equal(url.searchParams.get('clientPhone'), '+79123456789');
      return {
        ok: true,
        status: 200,
        json: async () => ({
          content: [
            {
              id: 'energy-product',
              name: 'Энергия турниры',
              type: 'INDIVIDUAL',
              showToUser: false,
              cost: 2000000
            }
          ]
        })
      } as Response;
    }

    if (method === 'GET' && url.pathname === '/api/v1/products/subscriptions/energy-product') {
      assert.equal(url.searchParams.get('clientId'), 'client-1');
      assert.equal(url.searchParams.get('studioId'), 'studio-1');
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: 'energy-product',
          name: 'Энергия турниры',
          cost: 2000000
        })
      } as Response;
    }

    if (method === 'GET' && url.pathname === '/api/v1/contracts/clients/client-1') {
      assert.equal(url.searchParams.get('productIds'), 'energy-product');
      return {
        ok: true,
        status: 200,
        json: async () => ({ content: [] })
      } as Response;
    }

    if (method === 'POST' && url.pathname === '/api/v1/transactions') {
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      transactionBodies.push(body);
      if (body.successUrl) {
        return {
          ok: false,
          status: 400,
          json: async () => ({ message: 'Unknown field successUrl' })
        } as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: 'transaction-1',
          cardPaymentInfo: {
            paymentUrl: 'https://pay.example/admin-energy'
          },
          paymentDueDate: '2026-05-09T07:20:00+03:00',
          toPay: 250000,
          products: [
            {
              clientSubscriptionId: 'subscription-1'
            }
          ]
        })
      } as Response;
    }

    throw new Error(`Unexpected request: ${method} ${url.toString()}`);
  }) as typeof fetch;

  try {
    const result = await service.createTournamentEnergyCheckout({
      clientPhone: '79123456789',
      clientId: 'client-1',
      studioId: 'studio-1',
      paymentMethod: 'SMS',
      baseAmountMinor: 2000000,
      discountAmountMinor: 1750000,
      discountReason: 'Участие в турнире «Название турнира» 09.05.2026',
      successUrl: 'https://padlhub.ru/tournaments?paymentsuccess=true',
      failUrl: 'https://padlhub.ru/tournaments?paymentfailed=true',
      productName: 'Энергия турниры'
    });

    assert.equal(transactionBodies.length, 2);
    assert.equal(transactionBodies[0]?.successUrl, 'https://padlhub.ru/tournaments?paymentsuccess=true');
    assert.equal(transactionBodies[1]?.successUrl, undefined);
    assert.equal(transactionBodies[1]?.clientPhone, '+79123456789');
    assert.equal(transactionBodies[1]?.paymentMethod, 'SMS');
    assert.equal(transactionBodies[1]?.discountReason, 'Участие в турнире «Название турнира» 09.05.2026');
    const products = transactionBodies[1]?.products as Array<Record<string, unknown>>;
    assert.equal(products[0]?.id, 'energy-product');
    assert.equal(products[0]?.type, 'SUBSCRIPTION');
    assert.equal(products[0]?.discount, 1750000);
    assert.equal(result.clientId, 'client-1');
    assert.equal(result.productId, 'energy-product');
    assert.equal(result.transactionId, 'transaction-1');
    assert.equal(result.subscriptionId, 'subscription-1');
    assert.equal(result.paymentUrl, 'https://pay.example/admin-energy');
    assert.equal(result.toPayMinor, 250000);
    assert.equal(result.paymentExpiresAt, '2026-05-09T07:20:00+03:00');

    transactionBodies.length = 0;
    const observedSearchQueries = new Set<string>();
    globalThis.fetch = (async (requestUrl: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(requestUrl));
      const method = init?.method ?? 'GET';
      const headers = init?.headers as Record<string, string> | undefined;
      assert.equal(headers?.Authorization, 'Bearer admin-token');

      if (method === 'GET' && url.pathname === '/api/v2/search/clients') {
        observedSearchQueries.add(String(url.searchParams.get('q')));
        return {
          ok: true,
          status: 200,
          json: async () => ({ content: [] })
        } as Response;
      }
      if (method === 'GET' && url.pathname === '/api/v1/clients') {
        return {
          ok: false,
          status: 404,
          statusText: 'Not Found',
          json: async () => ({})
        } as Response;
      }
      if (method === 'GET' && url.pathname === '/api/v1/products') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ content: [{ id: 'energy-product', name: 'Энергия турниры', cost: 2000000 }] })
        } as Response;
      }
      if (method === 'GET' && url.pathname === '/api/v1/products/subscriptions/energy-product') {
        assert.equal(url.searchParams.get('clientId'), 'client-fallback');
        return {
          ok: true,
          status: 200,
          json: async () => ({ id: 'energy-product', name: 'Энергия турниры', cost: 2000000 })
        } as Response;
      }
      if (method === 'GET' && url.pathname === '/api/v1/contracts/clients/client-fallback') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ content: [] })
        } as Response;
      }
      if (method === 'POST' && url.pathname === '/api/v1/transactions') {
        const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
        transactionBodies.push(body);
        return {
          ok: true,
          status: 200,
          json: async () => ({
            id: 'transaction-fallback',
            cardPaymentInfo: { paymentUrl: 'https://pay.example/fallback' },
            toPay: 250000
          })
        } as Response;
      }

      throw new Error(`Unexpected fallback request: ${method} ${url.toString()}`);
    }) as typeof fetch;

    const fallbackResult = await service.createTournamentEnergyCheckout({
      clientPhone: '79123456789',
      clientId: 'client-fallback',
      studioId: 'studio-1',
      paymentMethod: 'SMS',
      baseAmountMinor: 2000000,
      discountAmountMinor: 1750000,
      discountReason: 'Участие в турнире «Название турнира» 09.05.2026',
      productName: 'Энергия турниры'
    });
    assert.equal(fallbackResult.clientId, 'client-fallback');
    assert.equal(fallbackResult.transactionId, 'transaction-fallback');
    assert.equal(fallbackResult.paymentUrl, 'https://pay.example/fallback');
    assert.ok(observedSearchQueries.has('+79123456789'));
    assert.ok(observedSearchQueries.has('79123456789'));
    assert.ok(observedSearchQueries.has('9123456789'));

    transactionBodies.length = 0;
    globalThis.fetch = (async (requestUrl: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(requestUrl));
      const method = init?.method ?? 'GET';
      const headers = init?.headers as Record<string, string> | undefined;
      assert.equal(headers?.Authorization, 'Bearer admin-token');

      if (method === 'GET' && url.pathname === '/api/v2/search/clients') {
        const q = String(url.searchParams.get('q'));
        if (q === '9123456789') {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              content: [{ id: 'client-by-10', phone: '+79123456789', name: 'Игрок 10' }]
            })
          } as Response;
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({ content: [] })
        } as Response;
      }
      if (method === 'GET' && url.pathname === '/api/v1/products') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ content: [{ id: 'energy-product', name: 'Энергия турниры', cost: 2000000 }] })
        } as Response;
      }
      if (method === 'GET' && url.pathname === '/api/v1/products/subscriptions/energy-product') {
        assert.equal(url.searchParams.get('clientId'), 'client-by-10');
        return {
          ok: true,
          status: 200,
          json: async () => ({ id: 'energy-product', name: 'Энергия турниры', cost: 2000000 })
        } as Response;
      }
      if (method === 'GET' && url.pathname === '/api/v1/contracts/clients/client-by-10') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ content: [] })
        } as Response;
      }
      if (method === 'POST' && url.pathname === '/api/v1/transactions') {
        const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
        transactionBodies.push(body);
        return {
          ok: true,
          status: 200,
          json: async () => ({
            id: 'transaction-by-10',
            cardPaymentInfo: { paymentUrl: 'https://pay.example/by-10' },
            toPay: 250000
          })
        } as Response;
      }
      if (method === 'GET' && url.pathname === '/api/v1/clients') {
        throw new Error('Unexpected /api/v1/clients lookup when search by 10 digits succeeded');
      }

      throw new Error(`Unexpected 10-digit search request: ${method} ${url.toString()}`);
    }) as typeof fetch;

    const byTenDigitsResult = await service.createTournamentEnergyCheckout({
      clientPhone: '79123456789',
      studioId: 'studio-1',
      paymentMethod: 'SMS',
      baseAmountMinor: 2000000,
      discountAmountMinor: 1750000,
      discountReason: 'Участие в турнире «Название турнира» 09.05.2026',
      productName: 'Энергия турниры'
    });
    assert.equal(byTenDigitsResult.clientId, 'client-by-10');
    assert.equal(byTenDigitsResult.transactionId, 'transaction-by-10');
    assert.equal(byTenDigitsResult.paymentUrl, 'https://pay.example/by-10');
  } finally {
    globalThis.fetch = originalFetch;
  }

  console.log('Viva admin custom energy checkout test passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
