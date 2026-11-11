#!/usr/bin/env bash
# Verifies a break-glass proof. Called by action.yml after it has checked the
# branch and the re-run actor and fetched the signers file; test.sh calls it
# directly.
#
# The proof is JSON: {"payload":"<JSON object, as a string>","sig":"<SSHSIG body>"}.
# The signature covers the exact bytes of the payload string. The payload must
# carry aud (= REPO) and iat (unix seconds, not older than MAX_AGE nor more than
# MAX_SKEW in the future). Every other field belongs to the calling repository and
# is passed through unchecked.
#
# env: PROOF SIGNERS ACTOR REPO NAMESPACE MAX_AGE MAX_SKEW
#      GITHUB_OUTPUT GITHUB_STEP_SUMMARY (optional)
#      BREAK_GLASS_TEST_ALLOW_ANY_KEY=1 lets test.sh use a plain ed25519 key; action.yml blanks it
set -euo pipefail

fail() { echo "::error::$*"; exit 1; }
: "${PROOF:?}" "${SIGNERS:?}" "${ACTOR:?}" "${REPO:?}" "${NAMESPACE:?}" "${MAX_AGE:?}" "${MAX_SKEW:?}"
[[ "$MAX_AGE" =~ ^[0-9]+$ && "$MAX_SKEW" =~ ^[0-9]+$ ]] || fail "max-age and max-skew must be whole seconds"

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

jq -e 'type == "object" and (.payload | type) == "string" and (.sig | type) == "string"' \
  <<< "$PROOF" >/dev/null 2>&1 \
  || fail "the proof is not {\"payload\": \"...\", \"sig\": \"...\"}: produce it with break-glass-sign.sh and paste it whole"

# The exact signed bytes. -j: no trailing newline, as the helper signed with printf '%s'.
jq -j .payload <<< "$PROOF" > "$work/payload"
{
  echo '-----BEGIN SSH SIGNATURE-----'
  jq -r .sig <<< "$PROOF" | tr -d ' \n' | fold -w 70; echo
  echo '-----END SSH SIGNATURE-----'
} > "$work/sig.pem"

HINT="is @$ACTOR's sk- key in the signers file with principal '$ACTOR' (case-sensitive) and namespace '$NAMESPACE'?"
ssh-keygen -Y verify -f "$SIGNERS" -I "$ACTOR" -n "$NAMESPACE" -s "$work/sig.pem" < "$work/payload" >/dev/null 2>&1 \
  || fail "the proof does not verify for @$ACTOR; $HINT"

# Key type of the key embedded in the signature (SSHSIG wire format).
kt=$(python3 - "$work/sig.pem" <<'PY'
import base64, struct, sys
pem = open(sys.argv[1]).read().split("-----")[2]
blob = base64.b64decode("".join(pem.split()))
assert blob[:6] == b"SSHSIG", "not an SSH signature"
off = 10                                   # magic(6) + version(4)
(klen,) = struct.unpack(">I", blob[off:off+4]); key = blob[off+4:off+4+klen]
(tlen,) = struct.unpack(">I", key[:4]); print(key[4:4+tlen].decode())
PY
)
case "$kt" in
  sk-ssh-ed25519@openssh.com|sk-ecdsa-sha2-nistp256@openssh.com) ;;
  *) [ "${BREAK_GLASS_TEST_ALLOW_ANY_KEY:-}" = 1 ] \
       || fail "the proof verified but with a non-FIDO2 key ($kt); only sk- keys are accepted" ;;
esac

# The payload is signed, so from here on it is the signer's statement.
payload=$(jq -c . "$work/payload" 2>/dev/null) || fail "the signed payload is not JSON"
jq -e 'type == "object"' <<< "$payload" >/dev/null || fail "the signed payload is not a JSON object"

aud=$(jq -r '.aud // empty | strings' <<< "$payload")
[ "$aud" = "$REPO" ] || fail "the proof was signed for '${aud:-<no aud>}', this run is in '$REPO'"

iat=$(jq -r '.iat // empty | numbers | select(. == floor)' <<< "$payload")
[ -n "$iat" ] || fail "the signed payload has no whole-number iat"
now=$(date +%s)
if [ "$iat" -lt $((now - MAX_AGE)) ]; then
  fail "the proof was signed $((now - iat))s ago, more than the ${MAX_AGE}s allowed: sign a new one and dispatch again"
fi
if [ "$iat" -gt $((now + MAX_SKEW)) ]; then
  fail "the proof is dated $((iat - now))s in the future (more than ${MAX_SKEW}s): check the signing machine's clock"
fi

echo "proof verified: @$ACTOR signed $payload with a $kt key"
if [ -n "${GITHUB_OUTPUT:-}" ]; then
  # jq -c output is a single line, so the plain name=value form is safe.
  { echo "payload=$payload"; echo "signer=$ACTOR"; echo "key-type=$kt"; } >> "$GITHUB_OUTPUT"
fi
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  {
    echo "### 🔐 Break-glass proof verified"
    echo "- Signer: @$ACTOR (\`$kt\`), signed $((now - iat))s before verification"
    echo '- Payload:'
    echo '```json'
    jq . <<< "$payload"
    echo '```'
  } >> "$GITHUB_STEP_SUMMARY"
fi
