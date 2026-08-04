# Docker and integration agent instructions

These instructions extend the workspace-level `../AGENTS.md` for the
`yeti-docker` repository.

## Project map

- `dev`: local development Compose and bootstrap helpers.
- `prod`: production image orchestration and environment template.
- `integration-tests`: a disposable real backend/frontend/ArangoDB/Redis stack
  with Playwright smoke tests.

The canonical source layout is sibling repositories: `../yeti`,
`../yeti-feeds-frontend`, and `../yeti-docker`. Compose paths resolve from this
repository into those sibling checkouts. Do not add nested Git repositories or
Git links under `dev`.

## Commands

- Render development configuration: `docker compose -f dev/docker-compose.yaml config`
- Start development services: `docker compose -f dev/docker-compose.yaml up`
- Render integration configuration: `docker compose -f integration-tests/docker-compose.yaml config`
- Run the disposable real-stack suite: `(cd integration-tests && ./run.sh)`

The integration runner builds the sibling source checkouts, creates synthetic
credentials, runs Playwright, and removes its containers and volumes through an
exit trap. Read `integration-tests/README.md` before changing selectors or test
timing; it records known ArangoSearch and Vuetify behavior.

## Orchestration boundaries

- Never run `prod` Compose operations, publish images, remove persistent
  volumes, or generate/rotate credentials without explicit authorization.
- Keep real secrets in ignored `.env` files. Tracked examples must contain only
  safe placeholders or development defaults.
- Keep Compose build contexts relative and portable across macOS, Linux, and CI.
- Pin coupled versions together, especially the Playwright package and Docker
  image tag.
- Validate Compose rendering after YAML changes. Run the full integration suite
  when source paths, service health, authentication, or cross-stack behavior
  changes and local resources permit it.
