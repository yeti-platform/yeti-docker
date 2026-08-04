# Integration E2E suite

Runs Playwright against a real Yeti stack -- real ArangoDB, real API, real
frontend, no mocked network requests -- unlike the frontend's own e2e suite
(`../../yeti-feeds-frontend/tests/e2e`), which deliberately mocks every
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

This builds the sibling `yeti` and `yeti-feeds-frontend` repositories (whatever
you have checked out locally is what gets tested), starts a
fresh stack, seeds a test admin user, runs the suite, and tears everything
down again regardless of outcome. The frontend binds to host port `18080` by
default. Override the port when it is already in use; `run.sh` derives its
default `BASE_URL` from the selected port:

```sh
INTEGRATION_FRONTEND_PORT=18081 ./run.sh
```

You can also override the seeded credentials or provide an explicit target URL:

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
- **A successful observable search assertion does not make its row stable.**
  A pending refresh can replace the table immediately afterward and detach a
  link before Playwright clicks it. Verify the named link and its exact details
  `href` inside the retry, then navigate to that verified path before continuing
  with user-level edit/delete actions (see `tests/observable-lifecycle.spec.ts`).
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
- **Retrying entity/indicator searches only works if the search value actually
  changes.** Unlike Observables' search box (which calls `loadObjects()` on
  Enter), the entity/indicator pages and `EntitySelector` autocomplete depend
  on a changed Vue ref before issuing another request. Vue drops a same-value
  assignment as a no-op, so refilling identical text can leave the first stale
  result in place indefinitely. `clear()` then `fill()` on every retry (and
  press Enter for the page-level search boxes) to force a new request; see the
  entity, indicator, and entity-indicator-link specs.
- **The v-select used for fields like "Diamond model" (indicators) doesn't
  reliably `.click()`.** (The original cause -- the parent "New X"
  type-picker menu never closing once a type's dialog opened -- was fixed
  in yeti-feeds-frontend#297, but the keyboard approach below is still the
  more robust way to drive any Vuetify select/autocomplete in this suite.)
  Focus the input and drive it with the keyboard (`ArrowDown`, then click
  the option by role) instead -- see `tests/indicator-lifecycle.spec.ts`.
- **A search result's `role="option"` can be the whole `v-list-item`, not
  just the item's own name text.** `EntitySelector.vue` (used by the
  "link objects" dialog) binds the Vuetify selection props to that list item
  and renders only a separate "details" button inside it. Playwright's
  accessible-name computation for the option can include the details link,
  so match by raw text via
  `page.locator('[role="option"]').filter({ hasText: name })` and click the
  option itself. The nested details button deliberately stops propagation and
  does not select the result -- see `tests/entity-indicator-link.spec.ts`.
- **Deep-linking to a details-page tab via a URL `#hash` on a fresh page
  load can land on the wrong tab.** The hash-driven tab-selection watcher
  can race Vue Router's own initial hash resolution on a cold `page.goto`
  (confirmed by dumping every tab's active state: the *right* tab's table
  had the real data, but a *different* tab was the one actually marked
  active/visible). Navigate without a hash and click the tab instead, like
  a real user would -- see `tests/entity-indicator-link.spec.ts`.
- **Neighbor tables (`DirectNeighbors.vue`) are also all mounted "eager"**,
  one per related-type tab, same as the object-search type tabs. Scope to
  `.v-window-item--active .v-data-table tbody tr:visible` -- both parts
  matter: `.v-window-item--active` picks the one real tab out of many
  identically-structured eager siblings, and `.v-data-table` excludes the
  object's own "Info" side panel, a plain (non-data-table) `<v-table>`
  that's always on the page and would otherwise leak its own rows into a
  bare `tbody tr` match.

## Adding a spec

Put it in `playwright/tests/`, reuse `tests/helpers.ts`'s `login()`. Specs
run sequentially (`playwright.config.ts` sets `workers: 1`) because they
share one real backend and database, unlike the frontend's isolated mocked
tests -- keep that in mind if a new spec's data could collide with another
spec's (e.g. use a unique value like `` `test-${Date.now()}` ``, as the
existing lifecycle spec does).
