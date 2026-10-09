#!/bin/sh
# =============================================================================
# Redis entrypoint: render the config template, then start Redis.
#
# Why this exists: redis-server does not expand environment variables in its
# configuration file. A `requirepass ${REDIS_PASSWORD}` line in redis.conf would
# be taken literally, so Redis would start with a password of the string
# "${REDIS_PASSWORD}" while appearing perfectly healthy.
#
# The rendered file is written to /run with mode 600 rather than being passed as
# `--requirepass` on the command line, because argv is visible to every process
# in the container via /proc and in `docker inspect`, whereas a root-owned 0600
# file is not.
# =============================================================================
set -eu

TEMPLATE=/usr/local/etc/redis/redis.conf.template
OUTPUT=/run/redis.conf

if [ -z "${REDIS_PASSWORD:-}" ]; then
    echo "FATAL: REDIS_PASSWORD is not set. Add it to deploy/oci/.env." >&2
    exit 1
fi

# A password containing a newline would let an attacker inject arbitrary
# directives into the rendered config, so refuse rather than escape it.
case "$REDIS_PASSWORD" in
    *'
'*)
        echo "FATAL: REDIS_PASSWORD must not contain a newline." >&2
        exit 1
        ;;
esac

REDIS_MAXMEMORY="${REDIS_MAXMEMORY:-384mb}"

# Escape the characters sed treats specially in a replacement string.
escaped_password=$(printf '%s' "$REDIS_PASSWORD" | sed -e 's/[\/&|]/\\&/g')
escaped_maxmemory=$(printf '%s' "$REDIS_MAXMEMORY" | sed -e 's/[\/&|]/\\&/g')

sed -e "s|__REDIS_PASSWORD__|${escaped_password}|g" \
    -e "s|__REDIS_MAXMEMORY__|${escaped_maxmemory}|g" \
    "$TEMPLATE" > "$OUTPUT"

chmod 600 "$OUTPUT"

# Fail loudly if any placeholder survived, rather than starting with a literal
# placeholder still in the password field.
if grep -q '__REDIS_' "$OUTPUT"; then
    echo "FATAL: redis config still contains unsubstituted placeholders." >&2
    exit 1
fi

# `exec` so Redis is PID 1 and receives SIGTERM directly, which is what triggers
# its AOF flush. Without exec, Compose's SIGTERM would kill the shell and the
# append-only file would be left unreconciled.
exec redis-server "$OUTPUT"
