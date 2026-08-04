#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$script_dir"

if [[ ! -f .env ]]; then
  cp .env.example .env
fi

if ! grep -q '^YETI_AUTH_SECRET_KEY=' .env; then
  secret_key="$(openssl rand -hex 64)"
  printf 'YETI_AUTH_SECRET_KEY=%s\n' "$secret_key" >> .env
fi

mkdir -p /opt/yeti/bloomfilters
docker compose up -d --wait --quiet-pull
