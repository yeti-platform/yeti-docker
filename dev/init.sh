#!/bin/bash

git clone git@github.com:yeti-platform/yeti.git
pushd yeti && git checkout frontend && popd
git clone git@github.com:yeti-platform/yeti-feeds-frontend.git

docker-compose build api
docker-compose up -d
