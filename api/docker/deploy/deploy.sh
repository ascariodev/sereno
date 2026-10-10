#!/bin/bash
# Instala dependencias, migra y reinicia un ambiente ya sincronizado (código en SERVER_DIR, .env del servidor).
# Corre después de rebuild-images.sh. Todo artisan como app (UID 1000), dueño de storage y bootstrap/cache.
set -euo pipefail
. "$(cd "$(dirname "$0")" && pwd)/env.sh"

if [ ! -f "$SERVER_DIR/.env" ]; then
  echo "error: falta $SERVER_DIR/.env (vive solo en el servidor)" >&2
  exit 1
fi

# storage/ no se sincroniza: en un ambiente nuevo hay que crear su estructura.
mkdir -p \
  "$SERVER_DIR/storage/app/public" \
  "$SERVER_DIR/storage/app/private" \
  "$SERVER_DIR/storage/framework/cache/data" \
  "$SERVER_DIR/storage/framework/sessions" \
  "$SERVER_DIR/storage/framework/testing" \
  "$SERVER_DIR/storage/framework/views" \
  "$SERVER_DIR/storage/logs" \
  "$SERVER_DIR/bootstrap/cache"

compose up -d postgres app nginx

if ! compose exec -T -u app app test -r .env; then
  echo "error: el usuario app (UID 1000) no puede leer $SERVER_DIR/.env" >&2
  exit 1
fi

# rsync deja el repo con el dueño del job (root): app no podría crear vendor/. El chown de vendor/ solo corre si
# hay algo ajeno, para no recorrerlo entero en cada deploy.
compose exec -T -u root app sh -c '
  mkdir -p vendor
  if [ -n "$(find vendor ! -user app -print -quit)" ]; then chown -R app:app vendor; fi
  chown -R app:app storage bootstrap/cache && chmod -R ug+rwX storage bootstrap/cache
'

# Los scripts de composer (package:discover) arrancan Laravel: por eso corre en app, con las extensiones del proyecto.
compose exec -T -u app app composer install --no-dev --no-interaction --prefer-dist --optimize-autoloader

artisan migrate --force
artisan db:seed --class=RoleSeeder --force
artisan optimize

# opcache.validate_timestamps=0: sin reinicio, los procesos seguirían con el código y la config anteriores.
compose up -d --remove-orphans
compose restart app queue scheduler reverb
# nginx resuelve app:9000 al arrancar: si app cambió de IP al reiniciarse, daría 502 hasta reiniciarlo.
compose restart nginx

for _ in $(seq 1 30); do
  if compose exec -T nginx wget -q -O /dev/null http://127.0.0.1/up 2>/dev/null; then
    [ ! -f "$PENDING_HASH_FILE" ] || mv "$PENDING_HASH_FILE" "$STORED_HASH_FILE"
    compose ps
    echo "deploy de $COMPOSE_PROJECT listo: /up responde 200"
    exit 0
  fi
  sleep 2
done
echo "error: /up de $COMPOSE_PROJECT no respondió 200 tras 30 intentos (60 s)" >&2
compose ps >&2 || true
compose logs --tail=30 app nginx >&2 || true
exit 1
