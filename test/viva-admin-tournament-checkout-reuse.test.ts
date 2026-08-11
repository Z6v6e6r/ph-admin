import * as assert from 'node:assert/strict';
import {
  VivaAdminService,
  VivaAdminTournamentEnergyCheckoutInput
} from '../src/integrations/viva/viva-admin.service';

const discountReason = 'Участие в турнире «Название турнира» 09.05.2026';
const checkoutInput: VivaAdminTournamentEnergyCheckoutInput = {
  clientPhone: '79123456789',
  clientId: 'client-1',
  studioId: 'studio-1',
  paymentMethod: 'SMS',
  baseAmountMinor: 2000000,
  discountAmountMinor: 1750000,
  discountReason,
  productName: 'Энергия турниры'
};

function futureDate(offsetMs = 20 * 60 * 1000): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

function activeTransaction(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'transaction-active',
    status: 'UNPAID',
    paymentMethod: 'SMS',
    discountReason,
    client: { id: 'client-1' },
    toPay: 250000,
    paymentDueDate: futureDate(),
    cardPaymentInfo: {
      status: 'PENDING',
      paymentUrl: 'https://pay.example/active'
    },
    products: [
      {
        id: 'energy-product',
        clientSubscriptionId: 'subscription-active'
      }
    ],
    ...overrides
  };
}

function createFetch(options: {
  transactions?: Record<string, unknown>[];
  transactionPayload?: unknown;
  transactionLookupStatus?: number;
  postDelayMs?: number;
}) {
  let transactionListRequests = 0;
  let transactionPostRequests = 0;

  const fetchMock = (async (requestUrl: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(requestUrl));
    const method = init?.method ?? 'GET';
    const headers = init?.headers as Record<string, string> | undefined;
    assert.equal(headers?.Authorization, 'Bearer admin-token');

    if (method === 'GET' && url.pathname === '/api/v2/search/clients') {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          content: [{ id: 'client-1', phone: '+79123456789', name: 'Игрок' }]
        })
      } as Response;
    }
    if (method === 'GET' && url.pathname === '/api/v1/products') {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          content: [{ id: 'energy-product', name: 'Энергия турниры', cost: 2000000 }]
        })
      } as Response;
    }
    if (method === 'GET' && url.pathname === '/api/v1/products/subscriptions/energy-product') {
      return {
        ok: true,
        status: 200,
        json: async () => ({ id: 'energy-product', name: 'Энергия турниры', cost: 2000000 })
      } as Response;
    }
    if (method === 'GET' && url.pathname === '/api/v1/contracts/clients/client-1') {
      return {
        ok: true,
        status: 200,
        json: async () => ({ content: [] })
      } as Response;
    }
    if (method === 'GET' && url.pathname === '/api/v1/transactions') {
      transactionListRequests += 1;
      assert.equal(url.searchParams.get('studioId'), 'studio-1');
      assert.equal(url.searchParams.get('status'), 'UNPAID');
      assert.equal(url.searchParams.get('paymentMethod'), 'SMS');
      assert.deepEqual(url.searchParams.getAll('productIds'), ['energy-product']);
      assert.deepEqual(url.searchParams.getAll('clientIds'), ['client-1']);
      const status = options.transactionLookupStatus ?? 200;
      return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => Object.prototype.hasOwnProperty.call(options, 'transactionPayload')
          ? options.transactionPayload
          : { content: options.transactions ?? [] }
      } as Response;
    }
    if (method === 'POST' && url.pathname === '/api/v1/transactions') {
      transactionPostRequests += 1;
      if (options.postDelayMs) {
        await new Promise((resolve) => setTimeout(resolve, options.postDelayMs));
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: 'transaction-created',
          status: 'UNPAID',
          paymentMethod: 'SMS',
          discountReason,
          toPay: 250000,
          paymentDueDate: futureDate(),
          cardPaymentInfo: {
            status: 'PENDING',
            paymentUrl: 'https://pay.example/created'
          },
          products: [{ id: 'energy-product', clientSubscriptionId: 'subscription-created' }]
        })
      } as Response;
    }

    throw new Error(`Unexpected request: ${method} ${url.toString()}`);
  }) as typeof fetch;

  return {
    fetchMock,
    counters: () => ({ transactionListRequests, transactionPostRequests })
  };
}

async function main(): Promise<void> {
  process.env.VIVA_ADMIN_API_TOKEN = 'admin-token';
  process.env.VIVA_ADMIN_API_BASE_URL = 'https://api.vivacrm.ru';
  process.env.TOURNAMENT_ENERGY_SUBSCRIPTION_IDS = '';
  const originalFetch = globalThis.fetch;

  try {
    const reusable = createFetch({ transactions: [activeTransaction()] });
    globalThis.fetch = reusable.fetchMock;
    const reusedResult = await new VivaAdminService().createTournamentEnergyCheckout(checkoutInput);
    assert.equal(reusedResult.transactionId, 'transaction-active');
    assert.equal(reusedResult.subscriptionId, 'subscription-active');
    assert.equal(reusedResult.paymentUrl, 'https://pay.example/active');
    assert.equal(reusable.counters().transactionListRequests, 1);
    assert.equal(reusable.counters().transactionPostRequests, 0);

    const terminal = createFetch({
      transactions: [
        activeTransaction({
          id: 'transaction-foreign-client',
          client: { id: 'client-2' }
        }),
        activeTransaction({
          id: 'transaction-cancelled',
          cardPaymentInfo: {
            status: 'CANCELED',
            paymentUrl: 'https://pay.example/cancelled'
          }
        }),
        activeTransaction({
          id: 'transaction-expired',
          paymentDueDate: new Date(Date.now() - 60_000).toISOString()
        }),
        activeTransaction({
          id: 'transaction-near-expiry',
          paymentDueDate: futureDate(10_000)
        })
      ]
    });
    globalThis.fetch = terminal.fetchMock;
    const createdAfterTerminal = await new VivaAdminService().createTournamentEnergyCheckout(checkoutInput);
    assert.equal(createdAfterTerminal.transactionId, 'transaction-created');
    assert.equal(terminal.counters().transactionPostRequests, 1);

    const lookupFailure = createFetch({ transactionLookupStatus: 503 });
    globalThis.fetch = lookupFailure.fetchMock;
    await assert.rejects(
      () => new VivaAdminService().createTournamentEnergyCheckout(checkoutInput),
      /Не удалось проверить активную оплату Viva/
    );
    assert.equal(lookupFailure.counters().transactionPostRequests, 0);

    const malformedLookup = createFetch({ transactionPayload: {} });
    globalThis.fetch = malformedLookup.fetchMock;
    await assert.rejects(
      () => new VivaAdminService().createTournamentEnergyCheckout(checkoutInput),
      /Не удалось проверить активную оплату Viva/
    );
    assert.equal(malformedLookup.counters().transactionPostRequests, 0);

    const malformedItem = createFetch({ transactionPayload: { content: [{}] } });
    globalThis.fetch = malformedItem.fetchMock;
    await assert.rejects(
      () => new VivaAdminService().createTournamentEnergyCheckout(checkoutInput),
      /Не удалось проверить активную оплату Viva/
    );
    assert.equal(malformedItem.counters().transactionPostRequests, 0);

    const unknownStatus = createFetch({
      transactions: [activeTransaction({
        cardPaymentInfo: {
          status: 'UNKNOWN_PROVIDER_STATUS',
          paymentUrl: 'https://pay.example/unknown'
        }
      })]
    });
    globalThis.fetch = unknownStatus.fetchMock;
    await assert.rejects(
      () => new VivaAdminService().createTournamentEnergyCheckout(checkoutInput),
      /Не удалось подтвердить статус активной оплаты Viva/
    );
    assert.equal(unknownStatus.counters().transactionPostRequests, 0);

    const missingStatus = createFetch({
      transactions: [activeTransaction({
        cardPaymentInfo: { paymentUrl: 'https://pay.example/missing-status' }
      })]
    });
    globalThis.fetch = missingStatus.fetchMock;
    await assert.rejects(
      () => new VivaAdminService().createTournamentEnergyCheckout(checkoutInput),
      /Не удалось подтвердить статус активной оплаты Viva/
    );
    assert.equal(missingStatus.counters().transactionPostRequests, 0);

    const concurrent = createFetch({ transactions: [], postDelayMs: 25 });
    globalThis.fetch = concurrent.fetchMock;
    const concurrentService = new VivaAdminService();
    const [first, second] = await Promise.all([
      concurrentService.createTournamentEnergyCheckout(checkoutInput),
      concurrentService.createTournamentEnergyCheckout(checkoutInput)
    ]);
    assert.equal(first.transactionId, 'transaction-created');
    assert.equal(second.transactionId, 'transaction-created');
    assert.equal(concurrent.counters().transactionListRequests, 1);
    assert.equal(concurrent.counters().transactionPostRequests, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }

  console.log('Viva admin tournament checkout reuse test passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
