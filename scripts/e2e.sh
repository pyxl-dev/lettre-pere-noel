#!/usr/bin/env bash
# Parcours complet en navigateur headless (scripts/browser-steps.mjs, Playwright) :
#   1. Alice écrit et envoie sa lettre (desktop 1440)
#   2. Bob voit la lettre scellée, écrit et envoie la sienne (mobile 375)
#   3. après la date d'ouverture, Alice ouvre la lettre de Bob (desktop)
#   4. Bob ouvre celle de Alice (mobile)
# État et mails isolés dans un dossier temporaire ; rien ne part sur Internet.
set -euo pipefail
cd "$(dirname "$0")/.."

PORT=${E2E_PORT:-8797}
SMTP=${E2E_SMTP_PORT:-2527}
OUT=${E2E_OUT:-.pilote-shots}
TMP=$(mktemp -d)
BASE="http://127.0.0.1:$PORT"
pids=()
cleanup() {
  for p in "${pids[@]:-}"; do [ -n "$p" ] && kill "$p" 2>/dev/null || true; done
  wait 2>/dev/null || true
  rm -rf "$TMP"
}
trap cleanup EXIT

cat > "$TMP/e2e.env" <<VARS
PERSON_A_NAME=Alice
PERSON_A_EMAIL=a@example.test
PERSON_A_TOKEN=jeton-dev-personne-a-0001
PERSON_B_NAME=Bob
PERSON_B_EMAIL=b@example.test
PERSON_B_TOKEN=jeton-dev-personne-b-0002
PUBLIC_URL=$BASE
SMTP_HOST=127.0.0.1
SMTP_PORT=$SMTP
SMTP_SECURE=off
SMTP_USER=dev
SMTP_PASS=dev
VARS

SINK_DIR="$TMP/mails" node scripts/smtp-sink.mjs "$SMTP" > "$TMP/sink.log" 2>&1 &
pids+=($!)

start() {
  npx wrangler dev --port "$PORT" --ip 127.0.0.1 --persist-to "$TMP/state" --env-file "$TMP/e2e.env" "$@" > "$TMP/wrangler.log" 2>&1 &
  WRANGLER=$!
  pids+=($WRANGLER)
  for _ in $(seq 1 60); do
    curl -sf "$BASE/" > /dev/null && return 0
    sleep 0.5
  done
  echo "wrangler dev ne démarre pas :" >&2
  tail -20 "$TMP/wrangler.log" >&2
  exit 1
}

run() {
  local steps=$1 viewport=$2
  if node scripts/browser-steps.mjs "$BASE" --out "$OUT" --viewports "$viewport" --steps "test/e2e/$steps" > "$TMP/run.json"; then
    echo "ok    $steps ($viewport)"
  else
    echo "ÉCHEC $steps ($viewport)"
    node -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1]));for(const v of r.results)for(const s of v.steps)if(!s.ok)console.log(JSON.stringify(s))' "$TMP/run.json"
    exit 1
  fi
}

start
run 0-cas-limites-desktop.json 1440x900
run 1-alice-ecrit-desktop.json 1440x900
run 2-bob-ecrit-mobile.json 375x812
kill "$WRANGLER"; wait "$WRANGLER" 2>/dev/null || true

# Même état, date d'ouverture passée : les lettres s'ouvrent.
start --var "REVEAL_AT:2026-01-01T00:00:00+01:00"
run 3-alice-ouvre-desktop.json 1440x900
run 4-bob-ouvre-mobile.json 375x812

mails=$(ls "$TMP/mails"/*.json 2>/dev/null | wc -l | tr -d ' ')
if [ "$mails" != "2" ]; then
  echo "ÉCHEC : $mails mail(s) reçu(s), 2 attendus"
  exit 1
fi
grep -q b@example.test "$TMP"/mails/*.json && grep -q a@example.test "$TMP"/mails/*.json
echo "ok    2 mails de notification reçus (un pour chacun)"
echo "Captures : $OUT"
