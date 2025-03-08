#!/bin/bash

git clone https://github.com/yeti-platform/yeti.git
cp yeti/yeti.conf.sample yeti/yeti.conf

git clone https://github.com/yeti-platform/yeti-feeds-frontend.git

docker compose up
