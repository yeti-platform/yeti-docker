#!/bin/bash

SECRET_KEY=$(openssl rand -hex 64)
sed -i '' "s/^YETI_AUTH_SECRET_KEY=.*/YETI_AUTH_SECRET_KEY=$SECRET_KEY/" yeti/.env
docker compose up
