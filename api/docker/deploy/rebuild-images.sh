#!/bin/bash
# Reconstruye la imagen y recrea los contenedores solo si cambió docker/ (sin los scripts de deploy), el compose
# o .dockerignore. Se recrean siempre: rsync reemplaza los archivos montados (default.conf) y un contenedor vivo
# seguiría viendo el viejo. El hash nuevo queda pendiente y deploy.sh lo guarda al terminar bien, así un deploy
# fallido reintenta el rebuild.
set -euo pipefail
. "$(cd "$(dirname "$0")" && pwd)/env.sh"

mkdir -p "$SERVER_DIR/.deploy"
new_hash=$(
  cd "$SERVER_DIR" &&
    { find docker -path docker/deploy -prune -o -type f -print; echo docker-compose.prod.yml; echo .dockerignore; } |
    LC_ALL=C sort | xargs sha256sum | sha256sum | cut -d' ' -f1
)
echo "$new_hash" > "$PENDING_HASH_FILE"

if [ -f "$STORED_HASH_FILE" ] && [ "$(cat "$STORED_HASH_FILE")" = "$new_hash" ]; then
  echo "sin cambios en docker/"
  exit 0
fi

echo "docker/ cambió (o no hay hash guardado): reconstruyendo $COMPOSE_PROJECT"
compose build
compose up -d --force-recreate --remove-orphans

for _ in $(seq 1 30); do
  if compose exec -T app true 2>/dev/null; then
    compose ps
    exit 0
  fi
  sleep 2
done
echo "error: app de $COMPOSE_PROJECT no respondió tras 30 intentos (60 s)" >&2
compose ps >&2 || true
exit 1
