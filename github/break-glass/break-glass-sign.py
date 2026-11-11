#!/usr/bin/env python3
"""Sign a break-glass proof with your enrolled YubiKey and print it.

    break-glass-sign.py <owner/repo> -f image_tag=v1.80.3 -f terraform_ref=main [--key ~/.ssh/break_glass]

Each -f key=value becomes a string field of the signed payload; which fields a
repository needs is up to its break-glass workflow. aud (the repository), iat (now)
and nonce are added here. Touch the key when it blinks, then paste the printed proof
into the workflow's "proof" input (Actions -> break-glass -> Run workflow). The proof
expires 10 minutes after signing.

    break-glass-sign.py ... | pbcopy     # macOS: straight to the clipboard

Python 3.9+, standard library only, plus ssh-keygen with FIDO2 support.
"""
import argparse
import json
import os
import re
import secrets
import subprocess
import sys
import time

RESERVED = ("aud", "iat", "nonce")


def ssh_keygen():
    # macOS: Apple's ssh-keygen has no FIDO2 support; prefer Homebrew's when present.
    if os.environ.get("SSH_KEYGEN"):
        return os.environ["SSH_KEYGEN"]
    return "/opt/homebrew/bin/ssh-keygen" if os.access("/opt/homebrew/bin/ssh-keygen", os.X_OK) else "ssh-keygen"


def build_payload(repo, fields, now=None, nonce=None):
    """The exact bytes to sign: compact JSON with aud, iat, nonce first."""
    claims = {"aud": repo, "iat": int(time.time()) if now is None else now,
              "nonce": secrets.token_hex(16) if nonce is None else nonce}
    claims.update(fields)
    return json.dumps(claims, separators=(",", ":"))


def sign(payload, key):
    """SSHSIG body (base64, no armor) over the payload bytes, namespace break-glass."""
    # stderr is left on the terminal for the PIN and touch prompts.
    res = subprocess.run([ssh_keygen(), "-Y", "sign", "-n", "break-glass", "-f", key],
                         input=payload.encode("utf-8"), stdout=subprocess.PIPE)
    if res.returncode != 0:
        sys.exit("signing failed")
    lines = res.stdout.decode("ascii").strip().splitlines()
    return "".join(lines[1:-1])


def parse_fields(pairs):
    fields = {}
    for pair in pairs:
        k, sep, v = pair.partition("=")
        if not sep or not k:
            raise ValueError(f"-f takes key=value (got '{pair}')")
        if k in RESERVED:
            raise ValueError(f"{k} is set by the helper")
        if k in fields:
            raise ValueError(f"field {k} given twice")
        fields[k] = v
    if not fields:
        raise ValueError("no fields: pass what the workflow expects, e.g. -f image_tag=... -f terraform_ref=...")
    return fields


def main(argv=None):
    p = argparse.ArgumentParser(description="Sign a break-glass proof and print it.")
    p.add_argument("repo", help="owner/repo, exactly as GitHub shows it")
    p.add_argument("-f", "--field", action="append", default=[], metavar="KEY=VALUE",
                   help="a field to sign (repeatable)")
    p.add_argument("--key", default=os.path.expanduser("~/.ssh/break_glass"), help="enrolled sk- key handle")
    args = p.parse_args(argv)

    if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", args.repo):
        p.error(f"repository must be owner/name, exactly as GitHub shows it (got '{args.repo}')")
    try:
        fields = parse_fields(args.field)
    except ValueError as e:
        p.error(str(e))
    if not os.path.isfile(args.key):
        p.error(f"key {args.key} not found; enrol with: "
                f"ssh-keygen -t ed25519-sk -O resident -O verify-required -f {args.key}")

    payload = build_payload(args.repo, fields)
    print(f"signing: {payload}", file=sys.stderr)
    print("touch the YubiKey (and enter its PIN) to sign...", file=sys.stderr)
    sig = sign(payload, args.key)
    # The proof: the exact signed bytes as a JSON string, and the signature's base64 body.
    print(json.dumps({"payload": payload, "sig": sig}, separators=(",", ":")))
    print("paste the line above into the workflow's 'proof' input within 10 minutes", file=sys.stderr)


if __name__ == "__main__":
    main()
