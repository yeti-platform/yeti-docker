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
- **Nested dialogs opened from within another dialog (e.g. "New Indicator"
  inside the link-objects dialog) teleport their content to the shared
  overlay root, not nested under their logical parent's DOM subtree.**
  Locators scoped to the parent dialog (e.g. `linkDialog.getByRole(...)`)
  silently find nothing for the *child* dialog's own content -- query it
  unscoped instead, using `page.getByRole("dialog").last()` to pick the
  most-recently-opened one. Also pin the *parent* dialog locator itself to
  `.first()` once a nested dialog can open inside it, so later lookups on
  the parent stay unambiguous regardless of whether the child dialog's
  close transition has fully finished (`getByRole("dialog")` alone can
  briefly match both) -- see `tests/entity-indicator-create-link.spec.ts`.
- **DFIQ objects (Scenario/Facet/Question) go through a completely
  different create/edit dialog** (`EditDFIQObject.vue`, YAML-backed) than
  everything else (`NewObject.vue`). Typed field values flow into an
  in-memory YAML document that's re-validated against
  `/api/v2/dfiq/validate` on a 500ms debounce, and Save stays disabled
  until that comes back valid -- wait for Save to become enabled with a
  generous timeout (e.g. 10s) rather than assuming it's immediate, see
  `tests/dfiq-scenario.spec.ts`.
- **The DFIQ tree's "new facet"/"new question" buttons on each node are
  hidden until that row is hovered** (a real CSS `:hover` reveal, not a
  click-to-expand toggle) -- `.hover()` the row before trying to click one,
  see `tests/dfiq-scenario-inline-question.spec.ts`.
- **The "Parents" field on a Question/Facet loads its options once, when
  the dialog mounts** (`EditDFIQObject.vue`'s `loadPossibleParents()`),
  not per keystroke like other search boxes in this app -- so there's a
  real ArangoSearch-view consistency window if you just created the
  parent scenario/facet moments earlier, and re-typing in the field won't
  help (the underlying fetch never re-runs). Poll the search API directly
  before opening the dialog instead of retrying inside it, see
  `tests/dfiq-question-multiple-parents.spec.ts`.
- **A bare `.click()` on a "Delete" confirm button doesn't wait for the
  DELETE request it triggers**, only for the click event to dispatch. An
  immediate follow-up API check (the pattern every lifecycle spec uses to
  confirm deletion) can race ahead of that in-flight request and see a
  stale 200 instead of 404 -- rare on a quiet run, but consistently
  reproducible once several other specs have already run in the same
  worker and pushed request latency up. `page.waitForResponse(...)`
  around the click, same as the tag-step pattern already used elsewhere,
  fixes it -- see any of the `*-lifecycle.spec.ts` files or
  `tests/dfiq-scenario.spec.ts`.
- **The same eventual-consistency gotcha applies to a spec's own cleanup
  step, not just its assertions.** A cleanup block that searches for an
  object it just created (rather than using an ID it already has) can hit
  the same ArangoSearch-view lag and silently find zero matches -- the
  loop over an empty array just does nothing, so the object leaks instead
  of the test failing loudly. Retry the search until it returns a match
  (`expect(...).toPass(...)`, same as the pre-flight check above) rather
  than searching once -- see `tests/dfiq-facet.spec.ts` and
  `tests/dfiq-scenario-inline-question.spec.ts`.
- **`getByLabel(X)` can fuzzy-match a field's own clear/show-password
  append icon, not just the field itself.** Vuetify auto-generates an
  `aria-label="X appended action"` for any `@click:append` icon (the
  clear button on "Reference"/"Step name", the eye icon on "Password",
  ...), and that contains the field's label as a substring, so
  `getByLabel` resolves to both and throws a strict-mode violation.
  Use `getByRole("textbox", { name: X })` instead, which only matches the
  actual input/textarea -- see `tests/rbac-group-membership.spec.ts` or
  `tests/dfiq-question-approaches.spec.ts`.
- **A `v-combobox`/`v-select`'s dropdown menu teleports to the shared
  overlay root, same as a nested dialog's content (see the gotcha above
  about `v-window-item--active`/neighbor tables for the general pattern)
  -- it is not nested under its logical container in the real DOM**, only
  in the accessibility-tree snapshot Playwright's error output shows,
  which can be misleading. A locator scoped to the container (e.g. a
  dialog) silently finds nothing for `role="option"`; query it unscoped
  via `page.getByRole("option", ...)` instead -- see
  `tests/rbac-group-membership.spec.ts`.
- **A multi-select `v-combobox`'s dropdown doesn't close itself after
  picking one option** (more could still be picked), so it can sit on top
  of and intercept clicks on whatever's below it until explicitly
  dismissed (e.g. `page.keyboard.press("Escape")`) -- see
  `tests/rbac-group-membership.spec.ts`.
- **The "v-select doesn't reliably `.click()`" gotcha above isn't
  specific to "Diamond model"** -- it applies to Vuetify `v-select`s
  generally in this suite (confirmed again on ACLEdit's "Role" field):
  focus + keyboard (`ArrowDown`, then click the option by role), not
  `.click()`.

## Adding a spec

Put it in `playwright/tests/`, reuse `tests/helpers.ts`'s `login()`. Specs
run sequentially (`playwright.config.ts` sets `workers: 1`) because they
share one real backend and database, unlike the frontend's isolated mocked
tests -- keep that in mind if a new spec's data could collide with another
spec's (e.g. use a unique value like `` `test-${Date.now()}` ``, as the
existing lifecycle spec does).
