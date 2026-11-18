import { TournamentsService } from '../src/tournaments/tournaments.service';

/** Payment service fixtures bypass HTTP; supply the identity capability a real controller issues.
 * Level evidence stays independent of the request's levelLabel. Admission itself is never mocked.
 */
export function withCanonicalTournamentActor(service: TournamentsService, rating = 3.25): TournamentsService {
  const target = service as any;
  target.playerRatingsService = { resolveCanonicalLevelByIdentity: async () => ({ ratingNumeric: rating, levelLabel: String(rating) }) };
  for (const name of ['registerPublicParticipant', 'createPublicJoinPurchaseTransaction', 'addPublicParticipantToWaitlist']) {
    const original = target[name].bind(service);
    target[name] = (slug: string, input: any) => original(slug, { ...input,
      trustedIdentity: target.rememberRegistrationIdentity({ phone: target.normalizePhone(input.phone), clientId: input.clientId }) });
  }
  return service;
}
