# Actual Yeti container
FROM python:3.10 AS yeti

# Python
RUN apt-get update && apt-get install -y \
    python3-pip \
    libmagic-dev \
    git \
    && apt-get clean && rm -rf /var/cache/apt/* /var/lib/apt/lists/*

RUN git clone https://github.com/yeti-platform/yeti.git /app
# RUN curl -o yeti.zip -L https://github.com/yeti-platform/yeti/archive/refs/heads/fastapi.zip && unzip yeti.zip && mv yeti-fastapi /app
WORKDIR /app
RUN git checkout fastapi
RUN cp yeti.conf.sample yeti.conf
RUN cp ./extras/docker/docker-entrypoint.sh /docker-entrypoint.sh

# Upgrade pip
RUN pip3 install --upgrade pip && pip3 install poetry

# Install yeti
RUN poetry install --with plugins

ENV PYTHONPATH /app

ENTRYPOINT ["/docker-entrypoint.sh"]

CMD ["webserver"]
