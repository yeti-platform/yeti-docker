#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repository_root="$(cd "$script_dir/.." && pwd)"
compose_file="$repository_root/integration-tests/docker-compose.yaml"
run_script="$repository_root/integration-tests/run.sh"
fixture_dir="$script_dir/fixtures"

assert_rendered_port() {
  local rendered_config=$1
  local expected_port=$2

  if ! grep -Eq "\"published\"[[:space:]]*:[[:space:]]*\"$expected_port\"" <<< "$rendered_config"; then
    printf 'expected rendered frontend host port %s\n' "$expected_port" >&2
    exit 1
  fi
}

default_config="$(env -u INTEGRATION_FRONTEND_PORT docker compose -f "$compose_file" config --format json)"
override_config="$(INTEGRATION_FRONTEND_PORT=18081 docker compose -f "$compose_file" config --format json)"
assert_rendered_port "$default_config" 18080
assert_rendered_port "$override_config" 18081

test_tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/yeti-integration-port.XXXXXX")"
trap 'rm -r "$test_tmp_dir"' EXIT
docker_test_log="$test_tmp_dir/docker.log"
harness_output="$test_tmp_dir/harness.out"

assert_harness_environment() {
  local expected_port=$1
  local expected_base_url=$2
  shift 2

  : > "$docker_test_log"
  env -u BASE_URL -u INTEGRATION_FRONTEND_PORT \
    PATH="$fixture_dir:$PATH" \
    DOCKER_TEST_LOG="$docker_test_log" \
    "$@" \
    "$run_script" > "$harness_output"

  grep -Fxq "INTEGRATION_FRONTEND_PORT=$expected_port" "$docker_test_log"
  grep -Fxq "BASE_URL=$expected_base_url" "$docker_test_log"
  if grep -Fq 'synthetic-secret-api-token' "$harness_output"; then
    printf 'create-user output leaked into integration logs\n' >&2
    exit 1
  fi
  grep -Fxq -- '--- Test user seeded without logging credentials ---' "$harness_output"
}

assert_harness_environment 18080 http://127.0.0.1:18080
assert_harness_environment 18081 http://127.0.0.1:18081 INTEGRATION_FRONTEND_PORT=18081

printf 'integration frontend port contract: ok\n'
