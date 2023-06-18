#!/bin/bash

git clone git@github.com:yeti-platform/yeti.git
pushd yeti && git checkout fastapi && popd

git clone git@github.com:yeti-platform/yeti-feeds-frontend.git
pushd yeti-feeds-frontend && git checkout fastapi && popd

docker compose build fastapi frontend
docker compose up -d
