#!/usr/bin/env bash
# Sign a break-glass proof with your enrolled YubiKey and print it.
#
#   break-glass-sign.sh <owner/repo> -f image_tag=v1.80.3 -f terraform_ref=main [--key ~/.ssh/break_glass]
#
# Each -f key=value becomes a string field of the signed payload; which fields a
# repository needs is up to its break-glass workflow. aud (the repository), iat
# (now) and nonce are added here. Touch the key when it blinks, then paste the
# printed proof into the workflow's "proof" input (Actions → break-glass → Run
# workflow). The proof expires 10 minutes after signing.
#
#   break-glass-sign.sh … | pbcopy     # macOS: straight to the clipboard
set -euo pipefail
usage() { echo "usage: break-glass-sign.sh <owner/repo> -f key=value [-f key=value …] [--key ~/.ssh/break_glass]" >&2; exit 2; }
REPO=${1:-}; [ -n "$REPO" ] && [ "${REPO#-}" = "$REPO" ] || usage; shift
[[ "$REPO" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || { echo "repository must be owner/name, exactly as GitHub shows it (got '$REPO')" >&2; exit 2; }
# macOS: Apple's ssh-keygen has no FIDO2 support; prefer Homebrew's when present.
SSH_KEYGEN=${SSH_KEYGEN:-$( [ -x /opt/homebrew/bin/ssh-keygen ] && echo /opt/homebrew/bin/ssh-keygen || echo ssh-keygen )}
KEY=~/.ssh/break_glass
fields='{}'
while [ $# -gt 0 ]; do
  case "$1" in
    -f|--field)
      [ $# -ge 2 ] && [[ "$2" == ?*=* ]] || { echo "-f takes key=value" >&2; exit 2; }
      k=${2%%=*}; v=${2#*=}
      case "$k" in aud|iat|nonce) echo "$k is set by the helper" >&2; exit 2 ;; esac
      jq -e --arg k "$k" 'has($k)' <<< "$fields" >/dev/null && { echo "field $k given twice" >&2; exit 2; }
      fields=$(jq -c --arg k "$k" --arg v "$v" '. + {($k): $v}' <<< "$fields"); shift 2 ;;
    --key) [ $# -ge 2 ] || usage; KEY=$2; shift 2 ;;
    *) echo "unknown option $1" >&2; usage ;;
  esac
done
[ "$fields" != '{}' ] || { echo "no fields: pass what the workflow expects, e.g. -f image_tag=… -f terraform_ref=…" >&2; exit 2; }
[ -f "$KEY" ] || { echo "key $KEY not found; enrol with: ssh-keygen -t ed25519-sk -O resident -O verify-required -f $KEY" >&2; exit 2; }

payload=$(jq -c --arg aud "$REPO" --argjson iat "$(date +%s)" --arg nonce "$(openssl rand -hex 16)" \
  '{aud: $aud, iat: $iat, nonce: $nonce} + .' <<< "$fields")
echo "signing: $payload" >&2
echo "touch the YubiKey (and enter its PIN) to sign..." >&2
sig=$(printf '%s' "$payload" | "$SSH_KEYGEN" -Y sign -n break-glass -f "$KEY")
# The proof: the exact signed bytes as a JSON string, and the signature's base64 body.
jq -cn --arg p "$payload" --arg s "$(printf '%s\n' "$sig" | sed '1d;$d' | tr -d '\n')" '{payload: $p, sig: $s}'
echo "paste the line above into the workflow's 'proof' input within 10 minutes" >&2
