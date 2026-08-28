#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repository_root="$(cd "$script_dir/.." && pwd)"
fixture_dir="$script_dir/source-bootstrap-fixtures"
source_refs="$repository_root/dev/source-refs.env"
workflow="$repository_root/.github/workflows/integration-e2e.yaml"

# shellcheck source=/dev/null
source "$source_refs"

if [[ ! "$YETI_REF" =~ ^[0-9a-f]{40}$ ]]; then
  printf 'YETI_REF must be a full Git commit SHA\n' >&2
  exit 1
fi
if [[ ! "$YETI_FEEDS_FRONTEND_REF" =~ ^[0-9a-f]{40}$ ]]; then
  printf 'YETI_FEEDS_FRONTEND_REF must be a full Git commit SHA\n' >&2
  exit 1
fi

grep -Fq "default: \"$YETI_REF\"" "$workflow"
grep -Fq "default: \"$YETI_FEEDS_FRONTEND_REF\"" "$workflow"
grep -Fq '## Migrating an existing nested checkout' "$repository_root/dev/README.md"

test_root="$(mktemp -d "${TMPDIR:-/tmp}/yeti-source-bootstrap.XXXXXX")"
trap 'rm -r "$test_root"' EXIT
workspace_root="$test_root/workspace"
test_repository="$workspace_root/yeti-docker"
mkdir -p "$test_repository/dev"
cp "$repository_root/dev/init.sh" "$repository_root/dev/source-refs.env" "$test_repository/dev/"

git_test_log="$test_root/git.log"
docker_test_log="$test_root/docker.log"

PATH="$fixture_dir:$PATH" \
  GIT_TEST_LOG="$git_test_log" \
  DOCKER_TEST_LOG="$docker_test_log" \
  "$test_repository/dev/init.sh" > "$test_root/first-run.out"

grep -Fq "checkout --detach $YETI_REF" "$git_test_log"
grep -Fq "checkout --detach $YETI_FEEDS_FRONTEND_REF" "$git_test_log"
grep -Fq 'docker compose -f' "$docker_test_log"
[[ "$(cat "$workspace_root/yeti/.git/test-head")" == "$YETI_REF" ]]
[[ "$(cat "$workspace_root/yeti-feeds-frontend/.git/test-head")" == "$YETI_FEEDS_FRONTEND_REF" ]]
[[ -f "$workspace_root/yeti/yeti.conf" ]]

printf '%040d\n' 9 > "$workspace_root/yeti/.git/test-head"
touch "$workspace_root/yeti/local-work-marker"
: > "$git_test_log"

PATH="$fixture_dir:$PATH" \
  GIT_TEST_LOG="$git_test_log" \
  DOCKER_TEST_LOG="$docker_test_log" \
  "$test_repository/dev/init.sh" > "$test_root/second-run.out" 2> "$test_root/second-run.err"

grep -Fq 'existing yeti checkout is at' "$test_root/second-run.err"
if grep -Fq 'checkout --detach' "$git_test_log"; then
  printf 'existing repositories must not be checked out automatically\n' >&2
  exit 1
fi
[[ -f "$workspace_root/yeti/local-work-marker" ]]

printf 'source bootstrap contract: ok\n'
