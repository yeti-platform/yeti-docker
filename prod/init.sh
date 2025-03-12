#!/bin/bash

SECRET_KEY=$(openssl rand -hex 64)
echo YETI_AUTH_SECRET_KEY=$SECRET_KEY >> .env
docker compose up -d --wait --quiet-pull
