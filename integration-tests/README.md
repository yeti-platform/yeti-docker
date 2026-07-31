# Integration E2E suite

Runs Playwright against a real Yeti stack -- real ArangoDB, real API, real
frontend, no mocked network requests -- unlike the frontend's own e2e suite
(`dev/yeti-feeds-frontend/tests/e2e`), which deliberately mocks every
`/api/v2/**` call and never starts a backend at all. This suite exists to
catch the class of bug that suite structurally can't: real backend bugs,
real auth flows, real timing/consistency issues across the stack.

It's intentionally a *smoke* suite, not a mirror of the frontend's full
component-level coverage: a handful of critical paths (login, create/tag/
search/delete an observable) rather than all 17+ specs. Growing it is easy
(see "Adding a spec" below) but the point is fast, high-value coverage for
release confidence, not exhaustive UI regression testing -- that's what the
mocked suite is for.

## Running it

```sh
./run.sh
```

This builds `dev/yeti` and `dev/yeti-feeds-frontend` (as checked out
locally -- whatever you have checked out is what gets tested), starts a
fresh stack, seeds a test admin user, runs the suite, and tears everything
down again regardless of outcome. Override the seeded credentials or target
URL via env vars if needed:

```sh
TEST_USERNAME=myuser TEST_PASSWORD='...' BASE_URL=http://127.0.0.1:18080 ./run.sh
```

Requires Docker with Compose v2, and enough free disk to build both images
(roughly 2-3GB net of layer caching).

### Running it manually, step by step

Useful when iterating on a spec, so you don't rebuild/reseed on every run:

```sh
cd integration-tests
docker compose up -d --build --wait
docker compose run --rm api create-user integration-test 'Integration-Test-Password-1!' --admin

cd playwright
npm ci
npx playwright test                    # if your host can run Playwright browsers directly
# otherwise, run inside the same container image CI uses:
docker run --rm --network host -v "$(pwd)":/work -w /work \
  -e BASE_URL=http://127.0.0.1:18080 \
  -e TEST_USERNAME=integration-test \
  -e TEST_PASSWORD='Integration-Test-Password-1!' \
  mcr.microsoft.com/playwright:v1.61.1-jammy \
  bash -c "npm ci && npx playwright test"

# when done:
cd .. && docker compose down --volumes --remove-orphans
```

The pinned `mcr.microsoft.com/playwright:v1.61.1-jammy` image ships browser
binaries matching the exact `@playwright/test` version in
`playwright/package.json` -- keep both in sync if you bump the dependency.
A bare-host Playwright browser install isn't guaranteed to work (it doesn't
on Debian 11, for instance).

## Running in CI

`.github/workflows/integration-e2e.yaml` is `workflow_dispatch`-only --
it doesn't run on every PR, since it's a multi-container, real-database
suite an order of magnitude slower than either repo's own test suite. Run
it manually from the Actions tab, optionally pointing `yeti_ref`/
`frontend_ref` at specific branches/tags/SHAs (defaults to `main` for
both). **Run this before cutting a release**, pointed at the commits you're
about to tag.

## Known gotchas

- **ArangoSearch views are eventually consistent**, same as in the
  backend's own test suite -- searching for something you just created or
  tagged may need a retry, not just a longer single wait (see
  `tests/observable-lifecycle.spec.ts`'s search step for the pattern).
  Deleting a *tagged* object in particular seems to widen this window well
  past what's reasonable to poll for (observed >15s vs ~1-2s for an
  untagged object) -- verify deletion via a direct API call instead of the
  search view in that case (see the same spec's final step).
- **`getByRole("dialog")`, not `.v-overlay--active`**, to target a dialog.
  Against a real backend, save/create snackbars are genuinely visible (not
  fast-forwarded like a mock) and also carry the `v-overlay--active` class,
  making that selector ambiguous whenever a toast happens to be up.
- **Entities/indicators render one `<table>` per type tab, all mounted
  "eager" (hidden, not destroyed) at once**, unlike Observables' single
  table. An empty table still renders a "no data" placeholder `<tr>`, so a
  bare `tbody tr` locator picks up rows from every hidden tab too -- scope
  to `tbody tr:visible` (see `tests/entity-lifecycle.spec.ts` /
  `tests/indicator-lifecycle.spec.ts`).
- **Retrying an entities/indicators search only works if the search box's
  value actually changes.** Unlike Observables' own search box (which calls
  `loadObjects()` directly on Enter), EntitySearch/IndicatorSearch only
  re-query when the underlying Vue ref's *value* changes on `keyup.enter`
  -- Vue refs are no-ops on an unchanged value, so refilling the same
  search text on every retry iteration silently never re-fires the
  request, and the test will hang on whatever the first (possibly stale)
  response was. `clear()` then `fill()` each retry to force a real change
  both ways (see the same two specs' search steps).
- **The v-select used for fields like "Diamond model" (indicators) doesn't
  reliably `.click()`.** The parent "New X" type-picker menu never actually
  closes once a type's create dialog opens (both overlays stay active,
  stacked), so a click at the select's computed coordinates can land on the
  stale menu layer instead of opening the dropdown. Focus the input and
  drive it with the keyboard (`ArrowDown`, then click the option by role)
  instead -- see `tests/indicator-lifecycle.spec.ts`.

## Adding a spec

Put it in `playwright/tests/`, reuse `tests/helpers.ts`'s `login()`. Specs
run sequentially (`playwright.config.ts` sets `workers: 1`) because they
share one real backend and database, unlike the frontend's isolated mocked
tests -- keep that in mind if a new spec's data could collide with another
spec's (e.g. use a unique value like `` `test-${Date.now()}` ``, as the
existing lifecycle spec does).
