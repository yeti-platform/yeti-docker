# Yeti Dev docker images

Clone this repo, then run `./init.sh`. You might need some additional steps:

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
poetry run uvicorn core.web.webapp:app --reload --host 0.0.0.0
```

NOTE: You can, of course, run all these commands directly into the `docker exec`
command:

```bash
docker compose exec api poetry run uvicorn core.web.webapp:app --reload --host 0.0.0.0
```

This will work for all the other commands in this doc.

### Celery

If you wanna work with feeds, you need to run a celery worker. To do so, you
need to run the following command from the `api` container (prompt like
`root@772ea966d9a8:/app#`)

```bash
poetry run celery -A core.taskscheduler worker --loglevel=INFO
```

### Settings

You can bring some tweaks to `yeti.conf` to make development a bit easier:

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
npm run serve
```
