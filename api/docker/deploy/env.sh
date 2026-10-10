# Se carga con `.` desde los demás scripts de deploy.
# DEPLOY_ENV: prod | qa | dev (proyecto compose sereno-<env>-api).
# HOST_DIR: ruta del ambiente en el host, la que ve el daemon de docker (/var/www/html/workspace/<env>/api).
# SERVER_DIR: la misma carpeta vista desde donde corre el script (/workspace/<env>/api en el job); por defecto HOST_DIR.

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

if [ ! -f "$SERVER_DIR/docker-compose.prod.yml" ]; then
  echo "error: no existe $SERVER_DIR/docker-compose.prod.yml" >&2
  exit 1
fi

DEPLOY_DIR="$(cd "$(dirname "$0")" && pwd)"
COMPOSE_PROJECT="sereno-$DEPLOY_ENV-api"
STORED_HASH_FILE="$SERVER_DIR/.deploy/docker.sha256"
PENDING_HASH_FILE="$SERVER_DIR/.deploy/docker.sha256.new"

# Git Bash convertiría las rutas /c/... de los -v en rutas de Windows.
export MSYS_NO_PATHCONV=1

compose() {
  sh "$DEPLOY_DIR/compose.sh" "$@"
}

artisan() {
  compose exec -T -u app app php artisan "$@"
}
