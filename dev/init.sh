#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
workspace_root="$(cd "$script_dir/../.." && pwd)"
# shellcheck source=/dev/null
source "$script_dir/source-refs.env"

require_commit_ref() {
  local name=$1
  local value=$2
  if [[ ! "$value" =~ ^[0-9a-f]{40}$ ]]; then
    printf '%s must be a full Git commit SHA\n' "$name" >&2
    exit 1
  fi
}

prepare_repository() {
  local repository=$1
  local pinned_ref=$2
  local target="$workspace_root/$repository"
  if [[ -d "$target/.git" || -f "$target/.git" ]]; then
    local current_ref
    if ! current_ref="$(git -C "$target" rev-parse HEAD)"; then
      printf 'unable to resolve the existing %s checkout: %s\n' "$repository" "$target" >&2
      exit 1
    fi
    if [[ "$current_ref" == "$pinned_ref" ]]; then
      printf 'present: %s (%s)\n' "$repository" "$current_ref"
    else
      printf 'warning: existing %s checkout is at %s; pinned ref is %s; leaving it unchanged\n' \
        "$repository" "$current_ref" "$pinned_ref" >&2
    fi
  elif [[ -e "$target" ]]; then
    printf 'refusing to overwrite non-repository path: %s\n' "$target" >&2
    exit 1
  else
    git clone "https://github.com/yeti-platform/$repository.git" "$target"
    git -C "$target" checkout --detach "$pinned_ref"
  fi
}

require_commit_ref YETI_REF "$YETI_REF"
require_commit_ref YETI_FEEDS_FRONTEND_REF "$YETI_FEEDS_FRONTEND_REF"
prepare_repository yeti "$YETI_REF"
prepare_repository yeti-feeds-frontend "$YETI_FEEDS_FRONTEND_REF"

if [[ ! -f "$workspace_root/yeti/yeti.conf" ]]; then
  cp "$workspace_root/yeti/yeti.conf.sample" "$workspace_root/yeti/yeti.conf"
fi

mkdir -p /tmp/bloomfilters
docker compose -f "$script_dir/docker-compose.yaml" up
