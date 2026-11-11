#!/usr/bin/env bash
# Tests break-glass-sign.sh and verify-proof/verify.sh together with a throwaway
# plain ed25519 key (CI has no YubiKey, so the sk- check is switched off with the
# test-only BREAK_GLASS_TEST_ALLOW_ANY_KEY=1; one case checks it is on otherwise).
#
#   github/break-glass/test.sh
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
t=$(mktemp -d); trap 'rm -rf "$t"' EXIT
ssh-keygen -q -t ed25519 -N '' -C test -f "$t/key"
ssh-keygen -q -t ed25519 -N '' -C other -f "$t/other"
echo "alice namespaces=\"break-glass\" $(cat "$t/key.pub")" > "$t/signers"

export SIGNERS="$t/signers" ACTOR=alice REPO=acme/app NAMESPACE=break-glass MAX_AGE=600 MAX_SKEW=120
export BREAK_GLASS_TEST_ALLOW_ANY_KEY=1
pass=0; failed=0

sign() { "$here/break-glass-sign.sh" "$@" 2>/dev/null; }
# Proof over an arbitrary payload string, signed with the given key.
proof_for() {
  local sig; sig=$(printf '%s' "$1" | ssh-keygen -Y sign -n "${3:-break-glass}" -f "${2:-$t/key}" 2>/dev/null)
  jq -cn --arg p "$1" --arg s "$(printf '%s\n' "$sig" | sed '1d;$d' | tr -d '\n')" '{payload: $p, sig: $s}'
}
run() { : > "$t/out"; GITHUB_OUTPUT="$t/out" GITHUB_STEP_SUMMARY="$t/summary" PROOF="$1" "$here/verify-proof/verify.sh" > "$t/log" 2>&1; }
ok()   { if run "$2"; then pass=$((pass+1)); echo "ok   $1"; else failed=$((failed+1)); echo "FAIL $1 (expected pass)"; cat "$t/log"; fi; }
bad()  { if run "$2"; then failed=$((failed+1)); echo "FAIL $1 (expected rejection)"; elif grep -q -- "$3" "$t/log"; then pass=$((pass+1)); echo "ok   $1"; else failed=$((failed+1)); echo "FAIL $1 (wrong error)"; cat "$t/log"; fi; }
check() { if eval "$2"; then pass=$((pass+1)); echo "ok   $1"; else failed=$((failed+1)); echo "FAIL $1"; fi; }

now=$(date +%s)
good=$(sign acme/app -f image_tag=v1.80.3 -f terraform_ref=main -f ticket='INC-1 "quoted" $(x)' --key "$t/key")

ok   "helper proof verifies" "$good"
payload=$(sed -n 's/^payload=//p' "$t/out")
check "payload output is the signed payload" '[ "$payload" = "$(jq -r .payload <<< "$good" | jq -c .)" ]'
check "custom fields pass through unchanged" '[ "$(jq -r .ticket <<< "$payload")" = "INC-1 \"quoted\" \$(x)" ] && [ "$(jq -r .terraform_ref <<< "$payload")" = main ]'
check "aud, iat, nonce set by the helper" 'jq -e ".aud == \"acme/app\" and (.iat|type) == \"number\" and (.nonce|test(\"^[0-9a-f]{32}$\"))" <<< "$payload" >/dev/null'
check "signer output" 'grep -qx "signer=alice" "$t/out"'
ok   "pretty-printed payload string verifies" "$(proof_for "$(jq -n --argjson iat "$now" '{aud:"acme/app",iat:$iat}')")"

tampered=$(jq -c '.payload |= sub("v1.80.3"; "v1.80.4")' <<< "$good")
bad  "changed payload byte" "$tampered" "does not verify"
ACTOR=bob bad "dispatcher is not the signer" "$good" "does not verify"
bad  "key not in signers file" "$(proof_for "{\"aud\":\"acme/app\",\"iat\":$now}" "$t/other")" "does not verify"
bad  "wrong namespace" "$(proof_for "{\"aud\":\"acme/app\",\"iat\":$now}" "$t/key" other)" "does not verify"
bad  "wrong aud" "$(proof_for "{\"aud\":\"acme/other\",\"iat\":$now}")" "signed for 'acme/other'"
bad  "missing aud" "$(proof_for "{\"iat\":$now}")" "signed for '<no aud>'"
bad  "iat too old" "$(proof_for "{\"aud\":\"acme/app\",\"iat\":$((now - 601))}")" "more than the 600s"
ok   "iat just inside max-age" "$(proof_for "{\"aud\":\"acme/app\",\"iat\":$((now - 590))}")"
bad  "iat too far ahead" "$(proof_for "{\"aud\":\"acme/app\",\"iat\":$((now + 300))}")" "in the future"
bad  "iat as a string" "$(proof_for "{\"aud\":\"acme/app\",\"iat\":\"$now\"}")" "no whole-number iat"
bad  "iat fractional" "$(proof_for "{\"aud\":\"acme/app\",\"iat\":$now.5}")" "no whole-number iat"
bad  "payload not an object" "$(proof_for "[1]")" "not a JSON object"
bad  "payload not JSON" "$(proof_for "break-glass:acme/app:tag:v1")" "not JSON"
bad  "proof not JSON" "garbage" "is not {"
bad  "proof missing sig" '{"payload":"{}"}' "is not {"
MAX_AGE=10m bad "bad max-age input" "$good" "whole seconds"
BREAK_GLASS_TEST_ALLOW_ANY_KEY= bad "non-sk key rejected outside tests" "$good" "non-FIDO2 key"

# Helper argument checks.
check "helper refuses to set aud"       '! sign acme/app -f aud=x --key "$t/key"'
check "helper refuses duplicate fields" '! sign acme/app -f a=1 -f a=2 --key "$t/key"'
check "helper needs a field"            '! sign acme/app --key "$t/key"'
check "helper needs owner/repo"         '! sign app -f a=1 --key "$t/key"'

echo "$pass passed, $failed failed"
[ "$failed" -eq 0 ]
