#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repository_root="$(cd "$script_dir/.." && pwd)"
fixture_dir="$script_dir/fixtures"
test_tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/yeti-production-env.XXXXXX")"
trap 'rm -r "$test_tmp_dir"' EXIT

cp "$repository_root/prod/init.sh" "$repository_root/prod/.env.example" "$test_tmp_dir/"
docker_test_log="$test_tmp_dir/docker.log"

run_bootstrap() {
  (
    cd "$test_tmp_dir"
    umask 022
    PATH="$fixture_dir:$PATH" \
      DOCKER_TEST_LOG="$docker_test_log" \
      ./init.sh > /dev/null
  )
}

environment_mode() {
  if stat -f '%Lp' "$test_tmp_dir/.env" > /dev/null 2>&1; then
    stat -f '%Lp' "$test_tmp_dir/.env"
  else
    stat -c '%a' "$test_tmp_dir/.env"
  fi
}

run_bootstrap
if [[ "$(environment_mode)" != 600 ]]; then
  printf 'expected a newly generated .env to use mode 600\n' >&2
  exit 1
fi

chmod 0644 "$test_tmp_dir/.env"
run_bootstrap
if [[ "$(environment_mode)" != 600 ]]; then
  printf 'expected an existing .env to be restricted to mode 600\n' >&2
  exit 1
fi

if [[ "$(grep -c '^YETI_AUTH_SECRET_KEY=' "$test_tmp_dir/.env")" != 1 ]]; then
  printf 'expected exactly one generated authentication secret\n' >&2
  exit 1
fi

printf 'production environment contract: ok\n'
