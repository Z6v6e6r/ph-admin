# LK2 quote intent and revision contract

The delegated v1 quote remains non-binding and requires a reservation-time recheck.
`serviceAllowed` describes the current signed payment intent; it is not a general
statement that the player can never book the service another way.

- Every intent resolves one current, active, fresh canonical target. Missing target,
  invalid RUB price/revision, or unavailable source fails closed. A started target is
  blocked, including when no subscription exists or full price was explicitly chosen.
- If supplied `target.expectedRevision` differs from the resolved revision, the result
  is `PRICE_CONFIRMATION_REQUIRED` with `serviceAllowed=false`, no selected subscription,
  no benefit and no entitlement lookup. Its price is the latest full-price reference.
  The caller must obtain confirmation and send a new signed request for that revision.
- `PAY_FULL_PRICE` selects no subscription and never applies a benefit. An optional
  preferred subscription ID is ignored. Zero, one or multiple subscriptions do not
  change the ordinary canonical price. Subscription-specific limits are not evaluated
  for this intent; normal provider/service admission still belongs to reservation.
- `USE_SUBSCRIPTION` requires an eligible selected benefit. Missing or denied benefit
  returns a blocked current intent with no payable price. A full-price alternative,
  when present, requires explicit choice and a new signed `PAY_FULL_PRICE` request.
  Multiple instances require selection; a foreign preferred ID is never used.
- `AUTO_BEST_PRICE` may return an eligible benefit or a confirmed ordinary-price
  alternative. An active-services denial permits fallback only when the quote explicitly
  carries `FULL_PRICE_WITHOUT_SUBSCRIPTION`; `BLOCK` and omitted modes remain blocked.

All defaults remain off. This source change does not enable flags, provision replay
indexes, create a booking/payment, publish rules or establish production acceptance.
