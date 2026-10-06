FROM php:8.4-cli-alpine

RUN apk add --no-cache git unzip icu-dev libzip-dev postgresql-dev linux-headers \
    && docker-php-ext-install pdo_pgsql pgsql intl zip bcmath pcntl \
    && apk del linux-headers

COPY --from=composer:2 /usr/bin/composer /usr/bin/composer

ARG UID=1000
ARG GID=1000
RUN addgroup -g ${GID} app && adduser -D -u ${UID} -G app app

WORKDIR /var/www/api
USER app

EXPOSE 8080
CMD ["php", "artisan", "serve", "--host=0.0.0.0", "--port=8080"]
