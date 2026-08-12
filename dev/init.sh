#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
workspace_root="$(cd "$script_dir/../.." && pwd)"

clone_if_missing() {
  local repository=$1
  local target="$workspace_root/$repository"
  if [[ -d "$target/.git" || -f "$target/.git" ]]; then
    printf 'present: %s\n' "$repository"
  elif [[ -e "$target" ]]; then
    printf 'refusing to overwrite non-repository path: %s\n' "$target" >&2
    exit 1
  else
    git clone "https://github.com/yeti-platform/$repository.git" "$target"
  fi
}

clone_if_missing yeti
clone_if_missing yeti-feeds-frontend

if [[ ! -f "$workspace_root/yeti/yeti.conf" ]]; then
  cp "$workspace_root/yeti/yeti.conf.sample" "$workspace_root/yeti/yeti.conf"
fi

mkdir -p /tmp/bloomfilters
docker compose -f "$script_dir/docker-compose.yaml" up
