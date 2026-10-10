#!/bin/sh
# El runner no tiene el plugin de compose: se ejecuta en un contenedor docker:cli con la carpeta del ambiente
# montada en la misma ruta del host, para que ./, el contexto de build y el .env resuelvan igual en el daemon.
set -eu
. "$(cd "$(dirname "$0")" && pwd)/env.sh"

exec docker run --rm -v /var/run/docker.sock:/var/run/docker.sock \
  -v "$HOST_DIR:$HOST_DIR" -w "$HOST_DIR" \
  docker:24.0.9-cli docker compose -p "$COMPOSE_PROJECT" -f docker-compose.prod.yml "$@"
