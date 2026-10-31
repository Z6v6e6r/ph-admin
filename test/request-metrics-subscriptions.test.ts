import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { HttpException } from '@nestjs/common';
import { lastValueFrom, of, throwError } from 'rxjs';
import { RequestMetricsInterceptor } from '../src/common/observability/request-metrics.interceptor';

type Recorded = { route: string; status: number; sample: Record<string, unknown> };

function context(path: string, statusCode = 200, originalUrl = path,
  baseUrl = '/api/internal/subscriptions') {
  return {
    getType: () => 'http',
    switchToHttp: () => ({
      getRequest: () => ({
        method: 'POST',
        baseUrl,
        route: { path },
        originalUrl,
        headers: { authorization: 'secret', 'x-subscriptions-integration-token': 'secret' },
        body: { clientSubscriptionId: 'private-id' }
      }),
      getResponse: () => ({ statusCode })
    })
  } as any;
}

test('records only a bounded subscription route template', async () => {
  const rows: Recorded[] = [];
  const interceptor = new RequestMetricsInterceptor({
    record: (route: string, _duration: number, status: number, sample: Record<string, unknown>) => {
      rows.push({ route, status, sample });
    }
  } as any);
  await lastValueFrom(interceptor.intercept(context('/shadow-quote', 200,
    '/api/internal/subscriptions/shadow-quote?clientSubscriptionId=private-id', ''), {
    handle: () => of({ blockers: [], privateId: 'not-logged' })
  }));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].route, 'POST /api/internal/subscriptions/shadow-quote');
  assert.equal(rows[0].status, 200);
  assert.doesNotMatch(JSON.stringify(rows[0]), /private-id|authorization|integration-token|blockers/);

  await lastValueFrom(interceptor.intercept(context('/shadow-quote', 200,
    '/api/internal/subscriptions/shadow-quote?clientSubscriptionId=private-id'), {
    handle: () => of({}),
  }));
  assert.equal(rows.length, 2);
  assert.equal(rows[1].route, 'POST /api/internal/subscriptions/shadow-quote');

  await lastValueFrom(interceptor.intercept(context('/sale-bindings/confirm', 200), {
    handle: () => of({ state: 'BOUND', clientSubscriptionId: 'private-id' })
  }));
  assert.equal(rows.length, 3);
  assert.equal(rows[2].route, 'POST /api/internal/subscriptions/sale-bindings/confirm');
  assert.doesNotMatch(JSON.stringify(rows[2]), /private-id|BOUND/);
});

test('records subscription errors without exception body and ignores unlisted raw paths', async () => {
  const rows: Recorded[] = [];
  const interceptor = new RequestMetricsInterceptor({
    record: (route: string, _duration: number, status: number, sample: Record<string, unknown>) => {
      rows.push({ route, status, sample });
    }
  } as any);
  await assert.rejects(() => lastValueFrom(interceptor.intercept(
    context('/entitlements/reserve', 503),
    { handle: () => throwError(() => new HttpException({ token: 'secret' }, 503)) }
  )));
  assert.equal(rows[0].route, 'POST /api/internal/subscriptions/entitlements/reserve');
  assert.equal(rows[0].status, 503);
  await lastValueFrom(interceptor.intercept(context('/unknown/private-id'), { handle: () => of({}) }));
  assert.equal(rows.length, 1);
});


test('readback success/failure use bounded labels without identity, proof, body or query contents', async () => {
  const rows: Recorded[] = [];
  const interceptor = new RequestMetricsInterceptor({
    record: (route: string, _duration: number, status: number, sample: Record<string, unknown>) => {
      rows.push({ route, status, sample });
    }
  } as any);
  for (const base of ['/api/internal/subscriptions', '/internal/subscriptions']) {
    const fullPath = `${base}/entitlements/readback`;
    for (const status of [200, 503]) {
      const response = { schemaVersion: 1, operationId: 'booking:private-operation',
        subscriptionInstanceId: 'subscription:private-instance', operationState: 'FAILED',
        compensationState: 'APPLIED', releaseReason: 'PROVIDER_REJECTED', providerBookingId: null };
      const result = lastValueFrom(interceptor.intercept(context('/entitlements/readback', status,
        `${fullPath}?token=private-query-token&operationId=private-query-operation`, base), {
        handle: () => status === 200 ? of(response) : throwError(() => new HttpException({
          ...response, proof: 'private-proof', token: 'private-error-token'
        }, status))
      }));
      if (status === 200) await result; else await assert.rejects(result);
      assert.equal(rows[rows.length - 1]?.route, `POST ${fullPath}`);
      assert.equal(rows[rows.length - 1]?.status, status);
    }
    await lastValueFrom(interceptor.intercept(context('', 200, `${fullPath}?token=private-fallback`, ''), {
      handle: () => of({ privateBody: 'private-response' })
    }));
    assert.equal(rows[rows.length - 1]?.route, `POST ${fullPath}`);
  }
  assert.equal(rows.length, 6);
  assert.doesNotMatch(JSON.stringify(rows), /private|secret|authorization|token|proof|operationId|subscriptionInstanceId|FAILED|APPLIED|PROVIDER_REJECTED/);
  await lastValueFrom(interceptor.intercept(context('/entitlements/readback/private-operation'), {
    handle: () => of({})
  }));
  assert.equal(rows.length, 6, 'unlisted operation-specific paths never create metric labels');
});
