# Installation

Follow the canonical instructions: https://yeti-platform.io/docs/getting-started/

`init.sh` creates an ignored `.env` from `.env.example` when needed and adds a
generated authentication secret. Never commit the resulting `.env`.

## ArangoDB memory

ArangoDB 3.11 does not read the container's memory limit. It sizes its block
cache, write buffers and edge cache from the RAM it detects on the host (about
30 %, 40 % and 25 % of the host's RAM minus 2 GiB), so on a shared host it grows
into the other services. The `arangodb` service in `docker-compose.yaml` carries
two commented settings that belong together:

- `mem_limit` and `memswap_limit`: the container's limit, both set to the same
  value so the container does not swap.
- `ARANGODB_OVERRIDE_DETECTED_TOTAL_MEMORY`: what ArangoDB should plan for,
  about 80 % of the limit. Integers only (`6500M`, `6G`; `6.5G` aborts arangod
  at startup). Below 4 GiB ArangoDB switches to fixed cache sizes.

Set the limit alone and ArangoDB still plans for the host's RAM, gets killed
when it reaches the limit, and `restart: unless-stopped` starts it again. Raise
both together for large first imports. The override bounds the caches, not
everything: ArangoSearch's index files are memory-mapped and have no cap in
3.11 Community.

## API workers

The `api` service runs uvicorn without the file reloader and with four worker
processes. Each worker imports every plugin when it starts, about 340 MiB, so
the worker count sets the API's memory: four workers need about 1.5 GiB, and
one worker per CPU core on a large host needs far more. Change the `--workers`
value in `docker-compose.yaml` to size it: more workers only help when several
clients, the Timesketch analyzers among them, query the API at the same time.
