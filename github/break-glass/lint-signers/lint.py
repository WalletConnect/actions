#!/usr/bin/env python3
"""Check a break-glass signers file (run by action.yml on PRs that touch it).

Every non-comment line must be an allowed_signers entry whose principals are exact
logins (no patterns) and whose key is an sk- (FIDO2) type that parses with
ssh-keygen. An empty file is allowed (a repository before its first enrolment);
verify-proof then rejects every run with a clear message.

    lint.py [signers-file]      # default .github/break-glass-signers
"""
import os
import re
import subprocess
import sys
import tempfile

FIDO2_KEY_TYPES = ("sk-ssh-ed25519@openssh.com", "sk-ecdsa-sha2-nistp256@openssh.com")
# A token is a run of non-space characters, where "quoted strings" may hold spaces.
TOKEN = re.compile(r'(?:[^\s"]|"[^"]*")+')
KEY_TYPE = re.compile(r"^(?:sk-|ssh-|ecdsa-)\S+$")


def parse_line(line):
    """(principals, key type, key) of an allowed_signers line: principals [options] keytype key [comment]."""
    tokens = TOKEN.findall(line)
    if len(tokens) < 3:
        raise ValueError("expected: principals [options] key-type key")
    principals, rest = tokens[0], tokens[1:]
    if not KEY_TYPE.match(rest[0]):
        rest = rest[1:]  # options
    if len(rest) < 2:
        raise ValueError("expected: principals [options] key-type key")
    return principals, rest[0], rest[1]


def key_parses(ktype, key):
    with tempfile.NamedTemporaryFile("w", suffix=".pub") as f:
        f.write(f"{ktype} {key}\n")
        f.flush()
        return subprocess.run(["ssh-keygen", "-l", "-f", f.name],
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0


def lint(path):
    """Returns (error messages, number of keys)."""
    errors, n = [], 0
    with open(path) as f:
        for lineno, line in enumerate(f, 1):
            if not line.strip() or line.lstrip().startswith("#"):
                continue
            n += 1
            try:
                principals, ktype, key = parse_line(line)
            except ValueError as e:
                errors.append((lineno, f"line {lineno}: {e}"))
                continue
            if re.search(r"[*?!]", principals):
                # A pattern would let the key sign for logins other than its owner's.
                errors.append((lineno, f"'{principals}': principals must be exact GitHub logins, not patterns"))
            elif ktype not in FIDO2_KEY_TYPES:
                errors.append((lineno, f"'{principals}': key type '{ktype}' is not a FIDO2 (sk-) key"))
            elif not key_parses(ktype, key):
                errors.append((lineno, f"'{principals}': key does not parse"))
            else:
                print(f"ok: {principals} ({ktype})")
    return errors, n


def main(argv):
    path = argv[1] if len(argv) > 1 else ".github/break-glass-signers"
    if not os.path.isfile(path):
        print(f"::error::{path} not found")
        return 1
    errors, n = lint(path)
    for lineno, msg in errors:
        print(f"::error file={path},line={lineno}::{msg}")
    if n == 0:
        print(f"::warning::{path} lists no keys yet; no one can run the break-glass path until a key is enrolled")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
