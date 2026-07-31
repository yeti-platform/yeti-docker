#!/bin/bash
# Spins up a fresh Yeti stack (built from local source), seeds a test user,
# runs the Playwright integration suite against it, and tears everything
# down again -- pass or fail.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

export TEST_USERNAME="${TEST_USERNAME:-integration-test}"
export TEST_PASSWORD="${TEST_PASSWORD:-Integration-Test-Password-1!}"
export BASE_URL="${BASE_URL:-http://127.0.0.1:18080}"

cleanup() {
  echo "--- Tearing down integration stack ---"
  docker compose down --volumes --remove-orphans
}
trap cleanup EXIT

echo "--- Building and starting the integration stack ---"
docker compose up -d --build --wait

echo "--- Seeding test user ($TEST_USERNAME) ---"
docker compose run --rm api create-user "$TEST_USERNAME" "$TEST_PASSWORD" --admin

echo "--- Running Playwright integration suite ---"
# Run inside the official Playwright image rather than on the host: it ships
# browser binaries matching the pinned @playwright/test version, which a bare
# host install can't guarantee (and outright fails on some OSes/versions).
# Keep this tag in sync with the @playwright/test version in
# playwright/package.json.
docker run --rm \
  --network host \
  -v "$(pwd)/playwright":/work -w /work \
  -e BASE_URL \
  -e TEST_USERNAME \
  -e TEST_PASSWORD \
  -e HOME=/root \
  mcr.microsoft.com/playwright:v1.61.1-jammy \
  bash -c "npm ci && npx playwright test"
