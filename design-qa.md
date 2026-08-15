# Subscription settings annotation QA

final result: passed

## Evidence

- Source visual truth: browser annotations Comments 1-5 and
  `design-qa-source.png`.
- Implementation: `design-qa-implementation-desktop.png` and
  `design-qa-implementation-mobile.png`.
- Desktop viewport and pixels: 1420 x 1200 CSS px, 1420 x 1200 image px,
  density 1:1.
- Mobile viewport and pixels: 390 x 844 CSS px, 390 x 844 image px,
  density 1:1.
- State: local DRAFT-only CUP, one stored model-v3 subscription type and one
  stored policy version.
- Full-view comparison: source and implementation were opened together in one
  comparison input at the same desktop viewport.
- Focused evidence: the desktop comparison covered the type-list header,
  policy heading, join controls and booking-window control; the separate mobile
  capture covered the type row, option badges and add-type action.

## Comparison history

### Pass 1 findings from the annotated source

- P1: the type catalogue shared a two-column grid with a permanently visible
  create form instead of occupying the full content width.
- P2: the policy heading and explanatory copy did not match the requested
  information hierarchy.
- P2: the join switch and duration range were split across columns instead of
  forming one ordered control group.
- P2: the booking-window selector exposed only 3, 4 and 5 days.
- P2: type rows did not summarize enabled policy controls.

### Fixes and post-fix evidence

- The type catalogue is a full-width card. `+ Добавить тип` is in its upper
  right and opens/closes the local create form; Cancel returns to the list.
- The heading is `Настройка подписки`; the immutable-version explanation was
  removed.
- `Присоединение к играм` now precedes `Разрешённый диапазон длительности` in
  one full-width group.
- Booking window contains every integer option from 1 through 14.
- Each type row shows compact badges derived from its latest policy: game
  creation, game joining, active-service limit, booking window, station-rule
  count and enabled non-disabled benefit-rule count.
- Desktop keeps the add action in the top-right and the summary on one row.
  Mobile stacks safely at 390 px with `scrollWidth === innerWidth === 390`.
- Add-type open/cancel interaction, focus return to the add button, policy
  summary readback and booking-window options were verified in the rendered
  browser. The button exposes `aria-controls` and the form has a stable ID.
- Latest-policy summaries use at most four concurrent requests. Partial policy
  failures preserve successful or last-known summaries and cannot abort the
  rest of the type list; stale generations are ignored. Successful summaries
  are reused for 60 seconds instead of refetched on every tab entry.
- A synthetic 503 on the first policy-summary request rendered exactly one
  `Сводка правил недоступна` state and zero false `Правила не настроены` states.
- Final browser console check returned zero errors and zero warnings.

## Required fidelity surfaces

- Fonts and typography: existing CUP font stack, weights and heading hierarchy
  were preserved; the renamed heading has the same optical weight as adjacent
  section headings.
- Spacing and layout rhythm: existing 14 px section gaps, 16 px card padding,
  radii and shadows were preserved. New badges wrap without overflow.
- Colors and tokens: existing `--cup-wine`, translucent cyan and lilac tokens
  are reused; no new palette was introduced.
- Image and icon fidelity: existing CUP vector icon markup is reused for the
  option summaries; the logo and decorative background are unchanged.
- Copy and content: all five annotation changes are present. DRAFT-only and
  UNVERIFIED safety language remains intact elsewhere.

## Residual P3

- With many enabled benefits, badge labels may wrap to a second line on narrow
  desktop widths; this is intentional and does not hide actions or data.
