# Tournament pending-payment reconciliation

This is a mandatory pre-deploy gate before enforcing the new bound tournament payment lifecycle.
The command is dry-run by default and never calls Viva or changes MongoDB.

```bash
npm run tournaments:pending-payments:reconcile
```

The report lists only masked phones, hashed transaction identifiers and a fingerprint of each
pre-correction pending record. Every row must be verified against the exact Viva transaction before
an apply decision is prepared:

- `EXPIRED_UNPAID` requires exact provider `transactionId`, exact status `UNPAID` and `verifiedAt`.
- `PAID_BOUND` requires a complete replacement with tournament/exercise/studio/widget/product,
  amount/currency, eligibility snapshot, and exact `verifiedPayment` evidence.

Apply is a separate destructive data gate and requires an explicit JSON decisions file:

```bash
npm run tournaments:pending-payments:reconcile -- \
  --decisions /absolute/path/reviewed-decisions.json \
  --apply
```

The script validates every decision and uses an element-level CAS. It stops on a changed or already
reconciled record. It does not infer paid state, delete records, or release a potentially paid seat.
`BOOKING_CREATION_IN_PROGRESS` is a valid capacity-holding subscription recovery state. Resolve it
only from exact Viva booking evidence; neither this tool nor an automatic retry replays the provider write.
After apply, rerun dry-run; deployment remains blocked until `count` is zero and paid replacements
have been finalized through the normal idempotent recovery path.
