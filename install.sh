#!/bin/sh
# HRIS self-hosted installer.
#
#   Install (Community, free):
#     curl -fsSL https://LICENSE-WEBSITE/install.sh | sh
#   Upgrade to Pro (command generated in HRIS > Lisensi & Paket after activating a license):
#     curl -fsSL https://LICENSE-WEBSITE/install.sh | sh -s -- --upgrade-code XXXX-XXXX-XXXX-XXXX
#   From a source checkout (builds the image locally):
#     sh install.sh --build .
#
# Running again in the same directory keeps .env (and every key) and only pulls and restarts.
# Nothing is published to the internet: the app binds to 127.0.0.1 unless --bind is given.
set -eu

# Filled in when the license website serves this script; unreplaced values count as empty.
RAW_BASE="${HRIS_RAW_BASE:-__HRIS_RAW_BASE__}"
DEFAULT_IMAGE="${HRIS_COMMUNITY_IMAGE:-__HRIS_COMMUNITY_IMAGE__}"
MANAGER_IMAGE="${HRIS_MANAGER_IMAGE:-__HRIS_MANAGER_IMAGE__}"
LICENSE_SERVER="${HRIS_LICENSE_SERVER:-__HRIS_LICENSE_SERVER__}"
case "$RAW_BASE" in __HRIS_*) RAW_BASE="" ;; esac
case "$DEFAULT_IMAGE" in __HRIS_*) DEFAULT_IMAGE="" ;; esac
case "$MANAGER_IMAGE" in __HRIS_*) MANAGER_IMAGE="" ;; esac
case "$LICENSE_SERVER" in __HRIS_*) LICENSE_SERVER="" ;; esac

DIR=""
IMAGE=""
BUILD_SRC=""
SITE_URL=""
PORT="3000"
PROJECT_NAME="hris"
PROJECT_NAME_SET="no"
BIND="127.0.0.1"
ADMIN_EMAIL=""
TRUST_PROXY="0"
UPGRADE_CODE=""
LIFECYCLE="no"
ASSUME_YES="no"

say() { printf '%s\n' "$*"; }
fail() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
usage() {
  cat <<'EOF'
Usage: install.sh [options]
  --dir DIR                 Install directory (default ./hris, or the current directory when it holds an installation)
  --image IMAGE             HRIS image tag or digest (default: the published Community image)
  --build SRC_DIR           Build the image from an HRIS source checkout instead of pulling
  --url URL                 Public URL users open (default http://localhost:PORT); must match your HTTPS domain
  --port PORT               Host port (default 3000); pick another one when 3000 is already in use
  --project-name NAME       Docker Compose project name for a new installation (default hris);
                            use a different name for a second installation on the same server
  --bind ADDRESS            Host address to bind (default 127.0.0.1; put a TLS reverse proxy in front)
  --trust-proxy N           Number of reverse proxies in front of the app (default 0)
  --admin-email EMAIL       First superadmin email (default admin@hris.local)
  --license-server URL      License website (HTTPS) used for activation and Pro upgrades
  --upgrade-code CODE       Switch an existing installation to HRIS Pro (code from Lisensi & Paket, valid 15 minutes)
  --lifecycle               Pro, Linux only: optional agent for automatic backup/update/rollback (mounts the Docker socket)
  --yes                     Do not ask questions
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --dir) DIR="$2"; shift 2 ;;
    --image) IMAGE="$2"; shift 2 ;;
    --build) BUILD_SRC="$2"; shift 2 ;;
    --url) SITE_URL="$2"; shift 2 ;;
    --port) PORT="$2"; shift 2 ;;
    --project-name) PROJECT_NAME="$2"; PROJECT_NAME_SET="yes"; shift 2 ;;
    --bind) BIND="$2"; shift 2 ;;
    --trust-proxy) TRUST_PROXY="$2"; shift 2 ;;
    --admin-email) ADMIN_EMAIL="$2"; shift 2 ;;
    --license-server) LICENSE_SERVER="$2"; shift 2 ;;
    --upgrade-code) UPGRADE_CODE="$2"; shift 2 ;;
    --lifecycle) LIFECYCLE="yes"; shift ;;
    --yes|-y) ASSUME_YES="yes"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) usage; fail "Unknown option: $1" ;;
  esac
done

case "$PORT" in ''|*[!0-9]*) fail "--port must be a number" ;; esac
printf '%s' "$PROJECT_NAME" | grep -Eq '^[a-z0-9][a-z0-9_-]{0,62}$' || fail "--project-name may only contain lowercase letters, digits, - and _."
case "$TRUST_PROXY" in ''|*[!0-9]*) fail "--trust-proxy must be a number" ;; esac
valid_image() { printf '%s' "$1" | grep -Eq '^[A-Za-z0-9][A-Za-z0-9./:_@-]{0,254}$'; }
valid_https() { printf '%s' "$1" | grep -Eq '^(https://[A-Za-z0-9.-]+(:[0-9]+)?|http://(localhost|127\.0\.0\.1)(:[0-9]+)?)/?$'; }
if [ -n "$IMAGE" ] && ! valid_image "$IMAGE"; then fail "--image contains invalid characters."; fi
if [ -n "$LICENSE_SERVER" ]; then
  valid_https "$LICENSE_SERVER" || fail "--license-server must be an HTTPS origin (plain HTTP only for localhost)."
  LICENSE_SERVER=${LICENSE_SERVER%/}
fi
if [ -n "$UPGRADE_CODE" ]; then
  printf '%s' "$UPGRADE_CODE" | grep -Eq '^[A-Za-z0-9-]{16,24}$' || fail "Invalid --upgrade-code."
fi

ask() { # ask VAR "Question" default
  eval "current=\${$1}"
  if [ -n "$current" ] || [ "$ASSUME_YES" = "yes" ] || [ ! -r /dev/tty ]; then
    [ -n "$current" ] || eval "$1=\$3"
    return
  fi
  printf '%s [%s]: ' "$2" "$3" > /dev/tty
  read -r answer < /dev/tty || answer=""
  eval "$1=\${answer:-\$3}"
}

rand_hex() {
  if command -v openssl >/dev/null 2>&1; then openssl rand -hex "$1"
  else od -An -tx1 -N"$1" /dev/urandom | tr -d ' \n'; fi
}
rand_password() { LC_ALL=C tr -dc 'A-Za-z0-9' < /dev/urandom | head -c 24; }
get_env() { sed -n "s/^$1=//p" .env | tail -n 1; }
set_env() { # set_env KEY VALUE; values are validated by the caller (no newline or backslash)
  umask 077
  awk -v k="$1" -v v="$2" 'index($0, k "=") == 1 { if (!done) print k "=" v; done = 1; next } { print } END { if (!done) print k "=" v }' .env > .env.tmp
  chmod 600 .env.tmp
  mv .env.tmp .env
}

# --- Preconditions -----------------------------------------------------------
command -v docker >/dev/null 2>&1 || fail "Docker is required (Docker Engine 24+ or Docker Desktop)."
docker compose version >/dev/null 2>&1 || fail "Docker Compose v2 is required (docker compose)."
compose_version=$(docker compose version --short 2>/dev/null | sed 's/^v//')
compose_major=$(printf '%s' "$compose_version" | cut -d. -f1)
compose_minor=$(printf '%s' "$compose_version" | cut -d. -f2)
if [ "${compose_major:-0}" -lt 2 ] || { [ "${compose_major:-0}" -eq 2 ] && [ "${compose_minor:-0}" -lt 24 ]; }; then
  fail "Docker Compose 2.24+ is required (found $compose_version)."
fi
docker info >/dev/null 2>&1 || fail "Cannot reach the Docker daemon. Start Docker or add this user to the docker group."
command -v curl >/dev/null 2>&1 || fail "curl is required."

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" 2>/dev/null && pwd || pwd)
if [ -z "$DIR" ]; then
  # The upgrade command is run inside the installation folder.
  if [ -f ./.env ] && [ -f ./compose.image.yml ]; then DIR="."; else DIR="./hris"; fi
fi
if [ -n "$UPGRADE_CODE" ] && [ ! -f "$DIR/.env" ]; then
  fail "No installation found in $DIR. Run the upgrade command inside the HRIS installation folder or pass --dir."
fi
mkdir -p "$DIR"
chmod 700 "$DIR"
DIR=$(CDPATH= cd -- "$DIR" && pwd)

fetch() { # fetch FILE (always refreshed so fixes to the compose files arrive with updates)
  if [ -f "$SCRIPT_DIR/$1" ] && [ "$SCRIPT_DIR" != "$DIR" ]; then cp "$SCRIPT_DIR/$1" "$DIR/$1"; return; fi
  if [ -z "$RAW_BASE" ]; then
    [ -f "$DIR/$1" ] && return
    fail "$1 not found next to install.sh. Set HRIS_RAW_BASE to the HTTPS URL that serves it."
  fi
  case "$RAW_BASE" in https://*|http://localhost*|http://127.0.0.1*) ;; *) fail "HRIS_RAW_BASE must use HTTPS." ;; esac
  curl -fsSL "$RAW_BASE/$1" -o "$DIR/$1.tmp" && mv "$DIR/$1.tmp" "$DIR/$1"
}

fetch compose.image.yml
fetch compose.external.yml
if [ -n "$MANAGER_IMAGE" ]; then fetch compose.manager.yml; fi
if [ "$LIFECYCLE" = "yes" ]; then fetch compose.lifecycle.yml; fi

cd "$DIR"
NEW_INSTALL="no"

if [ -f .env ]; then
  say "Existing installation found in $DIR: .env and every key are kept."
  # Older layouts used a separate Pro overlay; licensing now lives in the app.
  case "$(get_env COMPOSE_FILE)" in *compose.pro.yml*)
    if [ -f compose.lifecycle.yml ] && [ -n "$(get_env HRIS_AGENT_IMAGE)" ]; then set_env COMPOSE_FILE "compose.image.yml:compose.lifecycle.yml"
    else set_env COMPOSE_FILE "compose.image.yml"; fi ;;
  esac
  if [ -n "$LICENSE_SERVER" ] && [ -z "$(get_env HRIS_LICENSE_SERVER)" ]; then set_env HRIS_LICENSE_SERVER "$LICENSE_SERVER"; fi
  if [ -n "$IMAGE" ]; then set_env HRIS_IMAGE "$IMAGE"; fi
else
  NEW_INSTALL="yes"
  # A Compose project name owns its database volume. Reusing the name of an earlier
  # installation (another folder, or a deleted .env) would pair new passwords with old data.
  project_in_use() {
    [ -n "$(docker volume ls -q --filter "label=com.docker.compose.project=$1" 2>/dev/null)$(docker ps -aq --filter "label=com.docker.compose.project=$1" 2>/dev/null)" ]
  }
  if project_in_use "$PROJECT_NAME"; then
    [ "$PROJECT_NAME_SET" = "no" ] || fail "Project name '$PROJECT_NAME' is already used by another HRIS installation on this Docker host (old containers or database volume). Pass another --project-name, or run the installer in the old installation folder."
    base_name="$PROJECT_NAME"
    suffix=2
    while project_in_use "$base_name-$suffix" && [ "$suffix" -lt 50 ]; do suffix=$((suffix + 1)); done
    PROJECT_NAME="$base_name-$suffix"
    say "Docker already has another HRIS installation (project '$base_name'). This installation uses project '$PROJECT_NAME' so the old database is never reused."
  fi
  if [ -n "$BUILD_SRC" ]; then
    [ -f "$BUILD_SRC/Dockerfile" ] || fail "--build expects an HRIS source directory containing Dockerfile."
    IMAGE="hris-local:$(date +%Y%m%d%H%M%S)"
  fi
  IMAGE="${IMAGE:-$DEFAULT_IMAGE}"
  [ -n "$IMAGE" ] || fail "Provide --image (published HRIS image) or --build SRC_DIR."
  ask SITE_URL "Public URL" "http://localhost:$PORT"
  ask ADMIN_EMAIL "First superadmin email" "admin@hris.local"
  case "$SITE_URL" in
    https://*|http://localhost*|http://127.0.0.1*) ;;
    *) fail "--url must be HTTPS (plain HTTP only for localhost)." ;;
  esac
  printf '%s' "$SITE_URL" | grep -Eq '^[A-Za-z0-9:/._-]+$' || fail "Invalid --url."
  printf '%s' "$ADMIN_EMAIL" | grep -Eq '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' || fail "Invalid admin email."

  umask 077
  {
    say "# Generated by install.sh on $(date -u +%Y-%m-%dT%H:%M:%SZ). Keep private; back up with the database."
    say "# Changing ENCRYPTION_KEY or STORAGE_SIGNING_SECRET later makes stored data or links unreadable."
    say "COMPOSE_PROJECT_NAME=$PROJECT_NAME"
    say "COMPOSE_FILE=compose.image.yml"
    say "HRIS_EDITION=community"
    say "HRIS_IMAGE=$IMAGE"
    say "HRIS_INSTALL_DIR=$DIR"
    say "BIND_ADDRESS=$BIND"
    say "APP_PORT=$PORT"
    say "NEXTAUTH_URL=$SITE_URL"
    say "TRUST_PROXY=$TRUST_PROXY"
    say "HRIS_LICENSE_SERVER=$LICENSE_SERVER"
    say "POSTGRES_ADMIN_PASSWORD=$(rand_hex 32)"
    say "HRIS_DB_NAME=hris"
    say "HRIS_DB_USER=hris"
    say "HRIS_DB_PASSWORD=$(rand_hex 32)"
    say "HRIS_DATABASE_URL="
    say "HRIS_DB_SSL=disable"
    say "AUTH_SECRET=$(rand_hex 32)"
    say "ENCRYPTION_KEY=$(rand_hex 32)"
    say "STORAGE_SIGNING_SECRET=$(rand_hex 32)"
    say "CRON_SECRET=$(rand_hex 32)"
    say "# Email: isi SMTP atau Resend sebelum memakai OTP/notifikasi. Verifikasi domain pengirim."
    say "EMAIL_PROVIDER=smtp"
    say "EMAIL_FROM="
    say "SMTP_HOST="
    say "SMTP_PORT=587"
    say "SMTP_USER="
    say "SMTP_PASS="
    say "RESEND_API_KEY="
    say ""
    say "# --- Opsional: kosong = nonaktif. Jalankan 'docker compose up -d' setelah mengubah. ---"
    say "# Ukuran pool koneksi database aplikasi."
    say "HRIS_DB_POOL_MAX=10"
    say "# Log audit: database (bawaan), axiom, atau http."
    say "AUDIT_LOG_PROVIDER=database"
    for key in AXIOM_DATASET AXIOM_TOKEN AUDIT_LOG_ENDPOINT AUDIT_LOG_TOKEN; do say "$key="; done
    say "# WhatsApp: none, fonnte, twilio, qontak, atau webhook."
    say "WA_PROVIDER=none"
    for key in FONNTE_TOKEN TWILIO_ACCOUNT_SID TWILIO_AUTH_TOKEN TWILIO_FROM_NUMBER QONTAK_API_TOKEN QONTAK_CHANNEL_INTEGRATION_ID QONTAK_TEMPLATE_ID QONTAK_BASE_URL QONTAK_DEFAULT_TO_NAME QONTAK_LANGUAGE_CODE; do say "$key="; done
    say "# Dipakai bila EMAIL_PROVIDER atau WA_PROVIDER = webhook (JSON POST)."
    say "NOTIFICATION_WEBHOOK_URL="
    say "# API lamaran publik (header x-api-key) dan Cloudflare Turnstile untuk form karier."
    say "PUBLIC_API_KEY="
    say "TURNSTILE_SECRET_KEY="
    say "# Pencarian alamat cabang (HTTPS, kompatibel Nominatim)."
    for key in GEOCODING_SEARCH_URL GEOCODING_USER_AGENT GEOCODING_PUBLIC_NOMINATIM_ACK; do say "$key="; done
    say "# SSO perusahaan OIDC (Pro)."
    for key in OIDC_NAME OIDC_ISSUER OIDC_CLIENT_ID OIDC_CLIENT_SECRET; do say "$key="; done
    say "# true hanya bila penjadwal eksternal memanggil /api/v1/cron/daily dengan CRON_SECRET."
    say "HRIS_DISABLE_SCHEDULER="
  } > .env
  chmod 600 .env
  printf '%s' "$ADMIN_EMAIL" > .bootstrap-pending
  say "Created $DIR/.env with random secrets (mode 600)."
fi

# Install the small public manager alongside Community. The Pro engine remains private.
if [ -n "$MANAGER_IMAGE" ] && [ "$LIFECYCLE" != "yes" ]; then
  valid_image "$MANAGER_IMAGE" || fail "Invalid manager image."
  case "$(get_env COMPOSE_FILE)" in *compose.lifecycle.yml*) fail "Existing lifecycle overlay needs a separate migration before enabling the new manager." ;; esac
  set_env HRIS_MANAGER_IMAGE "$MANAGER_IMAGE"
  [ -n "$(get_env HRIS_MANAGER_TOKEN)" ] || set_env HRIS_MANAGER_TOKEN "$(rand_hex 32)"
  [ -n "$(get_env HRIS_AGENT_TOKEN)" ] || set_env HRIS_AGENT_TOKEN "$(rand_hex 32)"
  set_env COMPOSE_FILE "compose.image.yml:compose.manager.yml"
fi
if [ -n "$(get_env HRIS_DATABASE_URL)" ]; then
  case "$(get_env COMPOSE_FILE)" in *compose.external.yml*) ;; *) set_env COMPOSE_FILE "$(get_env COMPOSE_FILE):compose.external.yml" ;; esac
fi

# --- Upgrade to Pro ------------------------------------------------------------
PREVIOUS_IMAGE=""
if [ -n "$UPGRADE_CODE" ]; then
  SERVER="${LICENSE_SERVER:-$(get_env HRIS_LICENSE_SERVER)}"
  [ -n "$SERVER" ] || fail "License server unknown. Pass --license-server https://LICENSE-WEBSITE."
  valid_https "$SERVER" || fail "HRIS_LICENSE_SERVER must be HTTPS."
  SERVER=${SERVER%/}
  say "Redeeming the upgrade code at $SERVER ..."
  umask 077
  answer_file=$(mktemp)
  trap 'rm -f "$answer_file"' EXIT
  status=$(curl -sS --proto '=https,http' --max-redirs 0 -o "$answer_file" -w '%{http_code}' \
    -X POST -H 'content-type: application/json' --data "{\"code\":\"$UPGRADE_CODE\"}" \
    "$SERVER/api/licenses/upgrade?format=env") || fail "Cannot reach the license server."
  if [ "$status" != "200" ]; then
    sed -n 's/.*"error":"\([^"]*\)".*/\1/p' "$answer_file" >&2
    echo >&2
    fail "Upgrade code rejected (HTTP $status). Create a new command in HRIS > Lisensi & Paket."
  fi
  value() { sed -n "s/^$1=//p" "$answer_file" | head -n 1; }
  REGISTRY=$(value REGISTRY); REG_USER=$(value REGISTRY_USERNAME); REG_PASS=$(value REGISTRY_PASSWORD)
  PRO_IMAGE=$(value HRIS_PRO_IMAGE); AGENT_IMAGE=$(value HRIS_AGENT_IMAGE); LICENSE_PUB=$(value LICENSE_PUBLIC_KEY_PEM_B64)
  rm -f "$answer_file"
  printf '%s' "$REGISTRY" | grep -Eq '^[A-Za-z0-9.-]+(:[0-9]{2,5})?$' || fail "License server returned an invalid registry."
  printf '%s' "$REG_USER" | grep -Eq '^inst_[A-Za-z0-9_]+$' || fail "License server returned an invalid username."
  printf '%s' "$REG_PASS" | grep -Eq '^[A-Za-z0-9_-]{20,200}$' || fail "License server returned an invalid credential."
  case "$PRO_IMAGE" in "$REGISTRY"/*) valid_image "$PRO_IMAGE" || fail "Invalid Pro image." ;; *) fail "Pro image is not in the private registry." ;; esac
  if [ -n "$AGENT_IMAGE" ]; then case "$AGENT_IMAGE" in "$REGISTRY"/*) valid_image "$AGENT_IMAGE" || AGENT_IMAGE="" ;; *) AGENT_IMAGE="" ;; esac; fi
  printf '%s' "$LICENSE_PUB" | grep -Eq '^[A-Za-z0-9+/=]*$' || LICENSE_PUB=""

  # Per-installation pull credential; pulls only work while the license is active.
  printf '%s' "$REG_PASS" | docker login "$REGISTRY" --username "$REG_USER" --password-stdin >/dev/null \
    || fail "docker login to $REGISTRY failed."
  unset REG_PASS
  PREVIOUS_IMAGE=$(get_env HRIS_IMAGE)
  set_env HRIS_PREVIOUS_IMAGE "$PREVIOUS_IMAGE"
  set_env HRIS_IMAGE "$PRO_IMAGE"
  set_env HRIS_EDITION pro
  set_env HRIS_LICENSE_SERVER "$SERVER"
  [ -z "$AGENT_IMAGE" ] || set_env HRIS_AGENT_IMAGE "$AGENT_IMAGE"
  [ -z "$LICENSE_PUB" ] || set_env LICENSE_PUBLIC_KEY_PEM_B64 "$LICENSE_PUB"
  say "Registry login saved for this installation ($REG_USER)."
fi

# --- Optional lifecycle agent (Pro) ------------------------------------------
if [ "$LIFECYCLE" = "yes" ]; then
  [ "$(get_env HRIS_EDITION)" = "pro" ] || fail "--lifecycle needs HRIS Pro. Upgrade first with --upgrade-code."
  [ -n "$(get_env HRIS_AGENT_IMAGE)" ] || fail "No agent image is published for this license server."
  [ -n "$(get_env LICENSE_PUBLIC_KEY_PEM_B64)" ] || fail "LICENSE_PUBLIC_KEY_PEM_B64 is missing; run the upgrade command again."
  # The agent manages containers through the host socket; Docker Desktop (macOS/Windows) is not supported.
  [ "$(uname -s)" = "Linux" ] || fail "--lifecycle is only supported on Linux servers. On macOS/Windows use manual backup and update."
  [ -S /var/run/docker.sock ] || fail "--lifecycle needs /var/run/docker.sock on a Linux host."
  set_env COMPOSE_FILE "compose.image.yml:compose.lifecycle.yml"
  set_env DOCKER_GID "$(stat -c %g /var/run/docker.sock 2>/dev/null || stat -f %g /var/run/docker.sock)"
  [ -n "$(get_env HRIS_AGENT_TOKEN)" ] || set_env HRIS_AGENT_TOKEN "$(rand_hex 32)"
  [ -n "$(get_env AUTO_BACKUP_INTERVAL_HOURS)" ] || set_env AUTO_BACKUP_INTERVAL_HOURS 24
  [ -n "$(get_env AUTO_UPDATE_INTERVAL_HOURS)" ] || set_env AUTO_UPDATE_INTERVAL_HOURS 0
  mkdir -p backups
  chmod 700 backups
  # The agent runs as uid 1001; only its backup folder is writable for it.
  chown 1001:1001 backups 2>/dev/null || say "Run: sudo chown 1001:1001 $DIR/backups  (agent backups need it)"
fi

# --- Pull and start ------------------------------------------------------------
if [ -n "$BUILD_SRC" ]; then
  [ -f "$BUILD_SRC/Dockerfile" ] || fail "--build expects an HRIS source directory containing Dockerfile."
  IMAGE=$(get_env HRIS_IMAGE)
  say "Building $IMAGE from $BUILD_SRC ..."
  docker build -t "$IMAGE" "$BUILD_SRC"
  docker compose pull --ignore-pull-failures postgres
elif ! docker compose pull; then
  if [ -n "$PREVIOUS_IMAGE" ]; then set_env HRIS_IMAGE "$PREVIOUS_IMAGE"; set_env HRIS_EDITION community; fi
  fail "Pull failed; nothing was changed. Check that the license is active, then create a new upgrade command."
fi
if [ -z "$(get_env HRIS_DATABASE_URL)" ]; then
  docker compose up -d --wait postgres || fail "The bundled database did not start. Details: docker compose logs postgres"
  # The init script only runs on an empty volume. Keep the application role and database in
  # line with .env on every run, so a changed HRIS_DB_PASSWORD never locks the app out.
  docker compose exec -T postgres psql -q -v ON_ERROR_STOP=1 -U postgres -d postgres <<'SQL' || fail "Could not prepare the application database role. Details: docker compose logs postgres"
\getenv app_user APP_DB_USER
\getenv app_password APP_DB_PASSWORD
\getenv app_db APP_DB_NAME
SELECT format('CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE', :'app_user') WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = :'app_user') \gexec
ALTER ROLE :"app_user" WITH LOGIN PASSWORD :'app_password';
SELECT format('CREATE DATABASE %I OWNER %I', :'app_db', :'app_user') WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = :'app_db') \gexec
SQL
fi
if ! docker compose up -d; then
  say "" >&2
  say "If the error mentions 'port is already allocated' or 'address already in use', port $(get_env APP_PORT) is taken." >&2
  say "Set another free port in $DIR/.env (APP_PORT, and NEXTAUTH_URL when it uses localhost), then run: docker compose up -d" >&2
  fail "Containers could not be started. Details: docker compose logs --tail 80"
fi

say "Waiting for HRIS to become healthy ..."
tries=0
until docker compose exec -T app wget -q -O /dev/null http://127.0.0.1:3000/api/v1/health 2>/dev/null; do
  tries=$((tries + 1))
  if [ "$tries" -ge 60 ]; then
    if [ -n "$PREVIOUS_IMAGE" ]; then
      say "HRIS Pro did not become healthy; switching back to $PREVIOUS_IMAGE ..."
      set_env HRIS_IMAGE "$PREVIOUS_IMAGE"
      set_env HRIS_EDITION community
      docker compose up -d app
    fi
    say "Last application log lines:" >&2
    docker compose logs --no-color --tail 25 app >&2 2>/dev/null || true
    fail "HRIS did not become healthy. Check: docker compose logs app"
  fi
  sleep 3
done

SITE_URL=$(get_env NEXTAUTH_URL)
if [ -f .bootstrap-pending ]; then
  SEED_ADMIN_EMAIL="$(cat .bootstrap-pending)"
  SEED_ADMIN_PASSWORD="$(rand_password)"
  export SEED_ADMIN_EMAIL SEED_ADMIN_PASSWORD
  # Passed by name so the password never appears in the process list; it is not written to disk.
  docker compose exec -T -e SEED_ADMIN_EMAIL -e SEED_ADMIN_PASSWORD app node db-seed.cjs > /dev/null
  say ""
  say "=============================================================="
  say " HRIS is running at $SITE_URL"
  say " Administrator login: $SITE_URL/auth/admin"
  say "   email:    $SEED_ADMIN_EMAIL"
  say "   password: $SEED_ADMIN_PASSWORD"
  say " This password is shown once. Sign in and change it now."
  say " Upgrade to Pro any time from Lisensi & Paket."
  say "=============================================================="
  unset SEED_ADMIN_PASSWORD
  rm -f .bootstrap-pending
elif [ -n "$UPGRADE_CODE" ]; then
  say ""
  say "=============================================================="
  say " HRIS Pro is running at $SITE_URL"
  say " Data, accounts and keys are unchanged. Reload Lisensi & Paket:"
  say " the edition now shows Pro and the licensed features are active."
  say "=============================================================="
else
  say "HRIS updated and running. Existing accounts and data were not changed."
fi
if [ -n "$(get_env HRIS_DATABASE_URL)" ]; then
  say "Database: external PostgreSQL from HRIS_DATABASE_URL (the bundled database is not started)."
else
  say "Database: bundled PostgreSQL (nothing to prepare). To use your own PostgreSQL later, put"
  say "      HRIS_DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/DB in $DIR/.env and run this installer again here."
  say "      Move existing data first (pg_dump/pg_restore); an empty database starts with no accounts."
fi
say "Next: put an HTTPS reverse proxy in front (set --url to that domain and --trust-proxy 1),"
say "      and back up $DIR/.env together with the database and uploads, e.g.:"
say "      docker compose exec -T postgres pg_dump -U postgres -Fc hris > hris-\$(date +%F).dump"
