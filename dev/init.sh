#!/bin/bash

git clone git@github.com:yeti-platform/yeti.git
pushd yeti && git checkout fastapi && popd
git clone git@github.com:yeti-platform/yeti-feeds-frontend.git

docker-compose build fastapi
docker-compose up -d
