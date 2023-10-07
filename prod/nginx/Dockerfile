#  Container used to build the minified frontend JS code
FROM node:buster AS frontend-builder

RUN apt update && apt install git python3
RUN npm install -g n && n 16

RUN git clone https://github.com/yeti-platform/yeti-feeds-frontend.git /app
WORKDIR /app
RUN git checkout fastapi

RUN npm install
RUN npm run build

FROM nginx:latest AS nginx
COPY --from=frontend-builder /app/dist /www
EXPOSE 80
