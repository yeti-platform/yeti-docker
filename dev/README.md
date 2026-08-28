# Yeti Dev docker images

Clone this repository next to `yeti` and `yeti-feeds-frontend`, then run
`./init.sh`. The script clones either missing sibling and starts the core
development stack. Fresh clones use the known-good commits recorded in
`source-refs.env`. Existing sibling checkouts are never moved or reset; the
script warns when their current commits differ from the recorded revisions.

AI services are optional; if a sibling `yeti-agents` checkout is configured,
start them with
`YETI_AGENTS_ENABLED=True docker compose --profile agents up`.

## Migrating an existing nested checkout

Older `yeti-docker` checkouts kept the backend and frontend as Git submodules at
`dev/yeti` and `dev/yeti-feeds-frontend`. Compose no longer reads those paths.

Preserve any local work before switching branches. The safest migration is to
commit it to a temporary local branch inside each nested repository, then clone
those repositories from the workspace directory that contains `yeti-docker`:

```bash
git clone https://github.com/yeti-platform/yeti.git ./yeti
git -C ./yeti fetch ../yeti-docker/dev/yeti HEAD:refs/heads/migrated-nested-work
git -C ./yeti switch migrated-nested-work

git clone https://github.com/yeti-platform/yeti-feeds-frontend.git ./yeti-feeds-frontend
git -C ./yeti-feeds-frontend fetch ../yeti-docker/dev/yeti-feeds-frontend HEAD:refs/heads/migrated-nested-work
git -C ./yeti-feeds-frontend switch migrated-nested-work
```

Do not simply move the directories: a submodule's `.git` file points back into
the `yeti-docker` Git metadata and will be invalid from the sibling location.
If committing locally is not appropriate, export and verify a patch that also
accounts for untracked files before migrating.

Confirm the branches, commits, uncommitted files, and local configuration in
both sibling repositories. The old nested paths are safe to delete only after
that verification. They may remain on disk and are ignored by Git, but neither
Compose nor the bootstrap scripts will use them.

## `api` container

The `api` container will run an `envshell`, so that it doesn't exit. To spin
up a api listener, you should launch the following commands from the
directory where the `docker-compose.yaml` file is.

```bash
docker compose exec api /bin/bash
```

Then once you get a root shell in the docker container (prompt like
`root@dcaa45f226bc:/app#`)

```bash
uv run uvicorn core.web.webapp:app --reload --host 0.0.0.0
```

NOTE: You can, of course, run all these commands directly into the `docker exec`
command:

```bash
docker compose exec api uv run uvicorn core.web.webapp:app --reload --host 0.0.0.0
```

This will work for all the other commands in this doc.

### Celery

If you wanna work with feeds, you need to run a celery worker. To do so, you
need to run the following command from the `api` container (prompt like
`root@772ea966d9a8:/app#`)

```bash
uv run celery -A core.taskscheduler worker --loglevel=INFO
```

### Events tasks

If you wanna work with events tasks, you need to run one or several events 
consumers. To do so, you need to run the following command from the `api` 
container (prompt like `root@772ea966d9a8:/app#`).

```bash
uv run python -m core.events.consumers events
```

You can adjust concurrency with `--concurrency <number_of_worker>` and enable
debugging output with `--debug`.

### Settings

If you want to make some tweaks to `yeti.conf` to make development a bit easier, 
copy the example file (`cp yeti.conf.sample yeti.conf`) and make changes such as:

The `[auth]` section should look like this:

```
[auth]

SECRET_KEY = SECRET
ALGORITHM = HS256
ACCESS_TOKEN_EXPIRE_MINUTES = 30
enabled = False
```

The [arangodb] section should look like this:

```
[arangodb]

host = arangodb
port = 8529
username = root
password =
database = yeti_dev
```

### Create User for dev

```
docker compose exec -it api /docker-entrypoint.sh create-user yeti yeti --admin
```
## `frontend` container

### First time run

The `frontend` container starts a `/bin/bash` shell, so that it doesn't exit. To
spin up a frontend listener, you should launch the following commands.

```bash
docker compose exec frontend /docker-entrypoint.sh dev
```

This will install all node modules so that the "installation" persists across
container reboots (see `yeti-feeds-frontend/docker/docker-entrypoint.sh`) and
then start a server listener. This will also set an install trace
`.node_installed` so that the command can be called again without all the
process of installing node modules.

### Server listener

```bash
docker compose exec frontend /bin/bash
```

Then once you get a root shell in the docker container (prompt like
`root@772ea966d9a8:/app#`):

```bash
npm run dev
```
