## Prod deployment

This will deploy a Yeti prod deployment:

* Built JS frontend, served statically by nginx
* nginx proxying API queries to the backend served by gunicorn

Run the deployment:

```bash
docker compose up
```

Should get you a Yeti instance running on http://localhost:80


## Add an admin user to Yeti

```bash
docker compose exec api yetictl create-user yeti yeti --admin
```
