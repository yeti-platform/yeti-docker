# Actual Yeti container
FROM python:3.10 AS yeti

# Python
RUN apt-get update && apt-get install -y \
    python3-pip \
    libmagic-dev \
    git

RUN git clone https://github.com/yeti-platform/yeti.git /app
WORKDIR /app
RUN git checkout fastapi
RUN cp ./extras/docker/scripts/docker-entrypoint.sh /docker-entrypoint.sh

# Upgrade pip
RUN pip3 install --upgrade pip && pip3 install poetry

# Install yeti
RUN poetry install --with plugins

ENTRYPOINT ["/docker-entrypoint.sh"]

CMD ["webserver"]
