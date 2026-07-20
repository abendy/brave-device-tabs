#!/usr/bin/env bash
# Interactive setup for the two PocketBase accounts SETUP.md step 2 needs:
# a superuser (admin-only, used once here) and a regular user (used day to
# day by the iOS app and the browser extension). Prompts for every value
# instead of taking them as flags so passwords never land in shell history.
set -euo pipefail

for bin in fly curl python3; do
  if ! command -v "$bin" >/dev/null 2>&1; then
    echo "Missing required command: $bin" >&2
    exit 1
  fi
done

login_body() {
  PB_ID="$1" PB_PW="$2" python3 -c \
    'import json, os; print(json.dumps({"identity": os.environ["PB_ID"], "password": os.environ["PB_PW"]}))'
}

create_user_body() {
  PB_EMAIL="$1" PB_PW="$2" python3 -c \
    'import json, os; pw = os.environ["PB_PW"]; print(json.dumps({"email": os.environ["PB_EMAIL"], "password": pw, "passwordConfirm": pw}))'
}

extract_json_field() {
  python3 -c "import sys, json; d = json.load(sys.stdin); print(d.get('$1', ''))"
}

read_password() {
  local prompt="$1" var_name="$2" value confirm
  while true; do
    read -rsp "$prompt: " value; echo
    read -rsp "Confirm $prompt: " confirm; echo
    if [[ "$value" == "$confirm" ]]; then
      printf -v "$var_name" '%s' "$value"
      return
    fi
    echo "Passwords did not match — try again." >&2
  done
}

echo "=== Device Tabs Share — PocketBase account setup ==="
echo

read -rp "Fly app name [device-tabs-sync]: " APP_NAME
APP_NAME=${APP_NAME:-device-tabs-sync}
APP_URL="https://${APP_NAME}.fly.dev"
echo "Using server: $APP_URL"
echo

read -rp "Superuser (admin) email: " ADMIN_EMAIL
read_password "Superuser password" ADMIN_PASSWORD

echo
echo "Creating/updating the superuser on $APP_NAME via fly ssh console..."
fly ssh console -a "$APP_NAME" -C "/pb/pocketbase superuser upsert $ADMIN_EMAIL $ADMIN_PASSWORD"

echo
echo "Logging in as superuser to get an admin token..."
ADMIN_TOKEN=$(curl -sf -X POST "$APP_URL/api/collections/_superusers/auth-with-password" \
  -H "Content-Type: application/json" \
  -d "$(login_body "$ADMIN_EMAIL" "$ADMIN_PASSWORD")" \
  | extract_json_field token)

if [[ -z "$ADMIN_TOKEN" ]]; then
  echo "Could not authenticate as superuser — check the email/password above." >&2
  exit 1
fi
echo "Got admin token."
echo

echo "--- Now the regular app user (used by iOS + the browser extension) ---"
read -rp "App user email [$ADMIN_EMAIL]: " APP_EMAIL
APP_EMAIL=${APP_EMAIL:-$ADMIN_EMAIL}
read_password "App user password" APP_PASSWORD

echo
echo "Creating app user..."
HTTP_CODE=$(curl -s -o /tmp/pb-create-user-response.json -w '%{http_code}' \
  -X POST "$APP_URL/api/collections/users/records" \
  -H "Authorization: $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d "$(create_user_body "$APP_EMAIL" "$APP_PASSWORD")")

if [[ "$HTTP_CODE" != "200" ]]; then
  echo "Failed to create app user (HTTP $HTTP_CODE):" >&2
  cat /tmp/pb-create-user-response.json >&2
  rm -f /tmp/pb-create-user-response.json
  exit 1
fi
rm -f /tmp/pb-create-user-response.json

echo "Confirming the app user can sign in..."
APP_TOKEN=$(curl -sf -X POST "$APP_URL/api/collections/users/auth-with-password" \
  -H "Content-Type: application/json" \
  -d "$(login_body "$APP_EMAIL" "$APP_PASSWORD")" \
  | extract_json_field token)

if [[ -z "$APP_TOKEN" ]]; then
  echo "App user was created but sign-in verification failed — check manually." >&2
  exit 1
fi

echo
echo "=== Done ==="
echo "Server URL:     $APP_URL"
echo "App user email: $APP_EMAIL"
echo
echo "Enter these in the iOS app's Setup screen and the extension's options page."
