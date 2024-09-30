# Yeti-Docker

## Warning in production environment

We have changed the volume setup in docker-compose.yml of production environment to correct an issue (shared volume between the contenairs for export data)
If you update the docker-compose.yml

* Backup
  
```
sudo docker compose run --rm -v $(pwd)/backup:/backup arangodb arangodump --server.endpoint tcp://a
rangodb:8529 --server.database yeti --output-directory /backup --overwrite true
```
* stop services
```
sudo docker compose down
```
* update
```
cd .. && git pull && cd prod && sudo docker compose up -d
```

* Restore
```
sudo docker compose run --rm -v $(pwd)/backup:/backup arangodb arangorestore --server.endpoint tcp://arangodb:8529 --input-directory /backup --server.database yeti --overwrite true
```


