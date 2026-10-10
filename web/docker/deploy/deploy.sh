#!/bin/bash
# Levanta la web de un ambiente ya sincronizado (dist/, la conf de nginx y el compose en SERVER_DIR; .env del servidor).
# DEPLOY_ENV: prod | qa | dev (proyecto compose sereno-<env>-web).
# HOST_DIR: ruta del ambiente en el host, la que ve el daemon de docker (/var/www/html/workspace/<env>/web).
# SERVER_DIR: la misma carpeta vista desde donde corre el script (/workspace/<env>/web en el job); por defecto HOST_DIR.
set -euo pipefail

: "${DEPLOY_ENV:?falta DEPLOY_ENV (prod, qa o dev)}"
: "${HOST_DIR:?falta HOST_DIR (ruta del ambiente en el host)}"
SERVER_DIR="${SERVER_DIR:-$HOST_DIR}"

case "$DEPLOY_ENV" in
  prod | qa | dev) ;;
  *)
    echo "error: DEPLOY_ENV debe ser prod, qa o dev (es '$DEPLOY_ENV')" >&2
    exit 1
    ;;
esac

for required in .env docker-compose.prod.yml docker/nginx/default.conf dist/index.html; do
  if [ ! -f "$SERVER_DIR/$required" ]; then
    echo "error: no existe $SERVER_DIR/$required" >&2
    exit 1
  fi
done

COMPOSE_PROJECT="sereno-$DEPLOY_ENV-web"
STORED_HASH_FILE="$SERVER_DIR/.deploy/nginx.sha256"

# Git Bash convertiría las rutas /c/... de los -v en rutas de Windows.
export MSYS_NO_PATHCONV=1

# El runner no tiene el plugin de compose: se ejecuta en un contenedor docker:cli con la carpeta del ambiente
# montada en la misma ruta del host, para que ./dist, la conf y el .env resuelvan igual en el daemon.
compose() {
  docker run --rm -v /var/run/docker.sock:/var/run/docker.sock \
    -v "$HOST_DIR:$HOST_DIR" -w "$HOST_DIR" \
    docker:24.0.9-cli docker compose -p "$COMPOSE_PROJECT" -f docker-compose.prod.yml "$@"
}

mkdir -p "$SERVER_DIR/.deploy"
new_hash=$(cd "$SERVER_DIR" && sha256sum docker-compose.prod.yml docker/nginx/default.conf | sha256sum | cut -d' ' -f1)

# dist/ se monta como carpeta: nginx lee del disco en cada petición y ve los archivos nuevos sin reinicio. La conf es
# un archivo montado y rsync la reemplaza (otro inodo): el contenedor seguiría viendo la vieja, por eso se recrea.
if [ -f "$STORED_HASH_FILE" ] && [ "$(cat "$STORED_HASH_FILE")" = "$new_hash" ]; then
  echo "sin cambios en la conf de nginx ni en el compose"
  compose up -d --remove-orphans
else
  echo "la conf de nginx o el compose cambió (o no hay hash guardado): recreando $COMPOSE_PROJECT"
  compose up -d --force-recreate --remove-orphans
fi

for _ in $(seq 1 30); do
  if compose exec -T web wget -q -O /dev/null http://127.0.0.1/ 2>/dev/null; then
    echo "$new_hash" > "$STORED_HASH_FILE"
    compose ps
    echo "deploy de $COMPOSE_PROJECT listo: / responde 200"
    exit 0
  fi
  sleep 2
done
echo "error: / de $COMPOSE_PROJECT no respondió 200 tras 30 intentos (60 s)" >&2
compose ps >&2 || true
compose logs --tail=30 web >&2 || true
exit 1
