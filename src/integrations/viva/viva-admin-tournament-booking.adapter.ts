/**
 * Viva admin ports for the server-owned tournament booking.
 *
 * - `createBooking` is the Viva cabinet's admin call `POST /api/v1/exercises/{id}/bookings`
 *   (`paymentType: ON_PLACE`), taken from the cabinet bundle. Without `createExerciseBooking`
 *   wired it rejects without any network call.
 * - `findBooking` reuses the existing read-only admin booking list.
 * - `createCheckout` reuses the existing admin booking checkout (`/api/v1/transactions` with
 *   `bookingIds`); a 100% discount confirms without a payment link.
 */
import type {
  ProviderBookingResult,
  ProviderCheckoutResult,
  TournamentServerBookingPrice,
  VivaAdminBookingCheckoutPort,
  VivaAdminBookingPort
} from '../../tournaments/tournament-server-booking';
import type {
  VivaAdminBookingPaymentCheckoutInput,
  VivaAdminBookingPaymentCheckoutResult
} from './viva-admin.service';

export interface VivaAdminTournamentBookingDeps {
  createExerciseBooking?(input: { exerciseId: string; clientId: string; phone: string }): Promise<ProviderBookingResult>;
  listExerciseBookings(exerciseId: string): Promise<Record<string, unknown>[]>;
  createBookingPaymentCheckout(input: VivaAdminBookingPaymentCheckoutInput): Promise<VivaAdminBookingPaymentCheckoutResult>;
}

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : typeof value === 'number' ? String(value) : null;

export class VivaAdminTournamentBookingAdapter implements VivaAdminBookingPort, VivaAdminBookingCheckoutPort {
  constructor(private readonly deps: VivaAdminTournamentBookingDeps) {}

  async createBooking(input: { clientId: string; exerciseId: string; phone: string }): Promise<ProviderBookingResult> {
    if (!this.deps.createExerciseBooking) {
      return { outcome: 'REJECTED', reasonCode: 'PROVIDER_BOOKING_METHOD_NOT_CONFIGURED' };
    }
    try {
      return await this.deps.createExerciseBooking({ exerciseId: input.exerciseId, clientId: input.clientId, phone: input.phone });
    } catch {
      return { outcome: 'UNKNOWN', reasonCode: 'PROVIDER_EXCEPTION' };
    }
  }

  async findBooking(input: { clientId: string; exerciseId: string }): Promise<{ bookingId: string } | null | 'UNAVAILABLE'> {
    let rows: Record<string, unknown>[];
    try {
      rows = await this.deps.listExerciseBookings(input.exerciseId);
    } catch {
      return 'UNAVAILABLE';
    }
    const matches = rows.flatMap((row) => {
      const item = record(row);
      const bookingId = text(item.bookingId) ?? text(item.id) ?? text(item.uuid);
      const exerciseId = text(item.exerciseId) ?? text(record(item.exercise).id);
      const clientId = text(item.clientId) ?? text(record(item.client).id);
      const cancelled = item.isCancelled === true || item.cancelled === true || item.canceled === true
        || ['CANCELLED', 'CANCELED', 'CANCEL', 'DELETED', 'REJECTED', 'REFUNDED'].includes(String(item.status ?? item.state ?? '').trim().toUpperCase());
      return bookingId && exerciseId === input.exerciseId && clientId === input.clientId && !cancelled ? [bookingId] : [];
    });
    const unique = Array.from(new Set(matches));
    if (unique.length === 0) return null;
    // Several active bookings for one client is not a recovery answer; keep it for an operator.
    return unique.length === 1 ? { bookingId: unique[0] } : 'UNAVAILABLE';
  }

  async createCheckout(input: {
    clientId: string;
    clientPhone: string;
    studioId: string;
    bookingId: string;
    price: TournamentServerBookingPrice;
  }): Promise<ProviderCheckoutResult> {
    const amountMinor = input.price.baseAmountMinor - input.price.discountMinor;
    let result: VivaAdminBookingPaymentCheckoutResult;
    try {
      result = await this.deps.createBookingPaymentCheckout({
        clientPhone: input.clientPhone,
        clientId: input.clientId,
        studioId: input.studioId,
        bookingIds: [input.bookingId],
        paymentMethod: 'SMS',
        amountMinor,
        baseAmountMinor: input.price.baseAmountMinor,
        discountAmountMinor: input.price.discountMinor,
        discountReason: input.price.discountReason,
        ...(input.price.productId ? { productId: input.price.productId } : {})
      });
    } catch {
      // The admin call may have created a transaction; reconciliation is manual.
      return { outcome: 'UNKNOWN', reasonCode: 'CHECKOUT_RESULT_UNKNOWN' };
    }
    const toPayMinor = result.paid === true ? 0 : result.toPayMinor ?? amountMinor;
    return {
      outcome: 'CREATED',
      transactionId: result.transactionId ?? null,
      paymentUrl: result.paymentUrl ?? null,
      toPayMinor,
      paid: result.paid === true || toPayMinor === 0,
      expiresAt: result.paymentExpiresAt ?? null
    };
  }
}
