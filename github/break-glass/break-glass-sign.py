#!/usr/bin/env python3
"""Sign a break-glass proof with your enrolled YubiKey and print it.

    break-glass-sign.py <owner/repo> -f image_tag=v1.80.3 -f terraform_ref=main [--key ~/.ssh/break_glass]

Each -f key=value becomes a string field of the signed payload; which fields a
repository needs is up to its break-glass workflow. aud (the repository) and iat
(now) are added here. Touch the key when it blinks, then paste the printed proof
into the workflow's "proof" input (Actions -> break-glass -> Run workflow). The proof
expires 10 minutes after signing.

    break-glass-sign.py ... | pbcopy     # macOS: straight to the clipboard

Python 3.9+, standard library only, plus ssh-keygen with FIDO2 support.
"""
import argparse
import json
import os
import re
import subprocess
import sys
import time

RESERVED = ("aud", "iat")


def ssh_keygen():
    # macOS: Apple's ssh-keygen has no FIDO2 support; prefer Homebrew's when present.
    if os.environ.get("SSH_KEYGEN"):
        return os.environ["SSH_KEYGEN"]
    return "/opt/homebrew/bin/ssh-keygen" if os.access("/opt/homebrew/bin/ssh-keygen", os.X_OK) else "ssh-keygen"


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


def main():
    p = argparse.ArgumentParser(description="Sign a break-glass proof and print it.")
    p.add_argument("repo", help="owner/repo, as GitHub shows it")
    p.add_argument("-f", "--field", action="append", default=[], metavar="KEY=VALUE",
                   help="a field to sign (repeatable)")
    p.add_argument("--key", default=os.path.expanduser("~/.ssh/break_glass"), help="enrolled sk- key handle")
    args = p.parse_args()
    if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", args.repo):
        p.error(f"repository must be owner/name (got '{args.repo}')")
    try:
        fields = parse_fields(args.field)
    except ValueError as e:
        p.error(str(e))

    # The exact bytes to sign: compact JSON, aud and iat first.
    payload = json.dumps({"aud": args.repo, "iat": int(time.time()), **fields}, separators=(",", ":"))
    print(f"signing: {payload}", file=sys.stderr)
    print("touch the YubiKey (and enter its PIN) to sign...", file=sys.stderr)
    # stderr is left on the terminal for the PIN and touch prompts. Without SSH_AUTH_SOCK:
    # ssh-keygen would hand the signing to an ssh-agent that holds the key, and an agent
    # cannot ask for the PIN ("agent refused operation").
    env = {k: v for k, v in os.environ.items() if k != "SSH_AUTH_SOCK"}
    res = subprocess.run([ssh_keygen(), "-Y", "sign", "-n", "break-glass", "-f", args.key],
                         input=payload.encode("utf-8"), stdout=subprocess.PIPE, env=env)
    if res.returncode != 0:
        sys.exit("signing failed")
    # The proof: the signed bytes as a JSON string, and the signature's base64 body (armor lines dropped).
    sig = "".join(res.stdout.decode("ascii").strip().splitlines()[1:-1])
    print(json.dumps({"payload": payload, "sig": sig}, separators=(",", ":")))
    print("paste the line above into the workflow's 'proof' input within 10 minutes", file=sys.stderr)


if __name__ == "__main__":
    main()
