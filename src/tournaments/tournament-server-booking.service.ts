import { HttpException, Injectable, Logger, Optional } from '@nestjs/common';
import { VivaAdminService } from '../integrations/viva/viva-admin.service';
import { VivaAdminTournamentBookingAdapter } from '../integrations/viva/viva-admin-tournament-booking.adapter';
import {
  readTournamentServerBookingMode,
  TournamentServerBookingAttempt,
  TournamentServerBookingCoordinator,
  TournamentServerBookingError,
  TournamentServerBookingRefusal,
  TournamentServerBookingStore,
  TournamentServerBookingView
} from './tournament-server-booking';
import { TournamentsPersistenceService } from './tournaments-persistence.service';
import { TournamentsService } from './tournaments.service';

/** Mongo attempt store; every write is majority-acknowledged and revision-fenced. */
export class MongoTournamentServerBookingStore implements TournamentServerBookingStore {
  constructor(private readonly collection: () => Promise<{
    findOne(filter: object, options?: object): Promise<unknown>;
    insertOne(doc: object, options?: object): Promise<unknown>;
    replaceOne(filter: object, doc: object, options?: object): Promise<{ matchedCount: number }>;
  }>) {}

  async find(id: string): Promise<TournamentServerBookingAttempt | null> {
    const collection = await this.collection();
    return (await collection.findOne({ _id: id }, {
      readPreference: 'primary', readConcern: { level: 'majority' }, maxTimeMS: 2000
    })) as TournamentServerBookingAttempt | null;
  }

  async insert(doc: TournamentServerBookingAttempt): Promise<boolean> {
    const collection = await this.collection();
    try {
      await collection.insertOne(doc, { writeConcern: { w: 'majority', j: true, wtimeoutMS: 5000 } });
      return true;
    } catch (error) {
      if ((error as { code?: number })?.code === 11000) return false;
      throw error;
    }
  }

  async replace(doc: TournamentServerBookingAttempt, expectedRevision: number): Promise<boolean> {
    const collection = await this.collection();
    const result = await collection.replaceOne({ _id: doc._id, revision: expectedRevision }, doc, {
      writeConcern: { w: 'majority', j: true, wtimeoutMS: 5000 }
    });
    return result.matchedCount === 1;
  }
}

@Injectable()
export class TournamentServerBookingService {
  private readonly logger = new Logger(TournamentServerBookingService.name);
  private readonly coordinator: TournamentServerBookingCoordinator;

  constructor(
    tournamentsService: TournamentsService,
    persistence: TournamentsPersistenceService,
    @Optional() vivaAdminService?: VivaAdminService
  ) {
    const viva = new VivaAdminTournamentBookingAdapter({
      createExerciseBooking: async (input) => {
        if (!vivaAdminService) return { outcome: 'REJECTED', reasonCode: 'VIVA_ADMIN_UNAVAILABLE' };
        return vivaAdminService.createExerciseBooking(input);
      },
      listExerciseBookings: async (exerciseId) => {
        if (!vivaAdminService) throw new Error('viva admin unavailable');
        return vivaAdminService.listExerciseBookings(exerciseId);
      },
      createBookingPaymentCheckout: async (input) => {
        if (!vivaAdminService) throw new Error('viva admin unavailable');
        return vivaAdminService.createBookingPaymentCheckout(input);
      }
    });
    this.coordinator = new TournamentServerBookingCoordinator({
      mode: () => readTournamentServerBookingMode(process.env),
      assertNewOperationsOpen: () => tournamentsService.assertTournamentOwnerNewOperationsOpen(),
      admission: { admit: (ref, auth) => tournamentsService.resolveServerBookingAdmission(ref, auth) },
      store: new MongoTournamentServerBookingStore(() => persistence.serverBookingAttemptsCollection()),
      booking: viva,
      checkout: viva,
      log: (event, fields) => this.logger.log(JSON.stringify({ event, ...fields }))
    });
  }

  async join(ref: string, authorization?: string, idempotencyKey?: string): Promise<TournamentServerBookingView> {
    const result = await this.run(() => this.coordinator.join(ref, authorization, idempotencyKey));
    if ('refused' in result) throw this.refusalException(result);
    return result;
  }

  status(ref: string, authorization?: string): Promise<TournamentServerBookingView> {
    return this.run(() => this.coordinator.status(ref, authorization));
  }

  private async run<T>(action: () => Promise<T>): Promise<T> {
    try {
      return await action();
    } catch (error) {
      if (error instanceof TournamentServerBookingError) {
        throw new HttpException({ code: error.code, message: error.message }, error.httpStatus);
      }
      throw error;
    }
  }

  private refusalException(refusal: TournamentServerBookingRefusal): HttpException {
    return new HttpException(
      { code: refusal.code, message: refusal.message, levelDecision: refusal.levelDecision },
      refusal.httpStatus
    );
  }
}
