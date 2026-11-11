#!/usr/bin/env python3
"""Manual end-to-end test of the break-glass proof with a real YubiKey.

    manual-test.py                            # makes a throwaway key on the YubiKey: two touches
    manual-test.py --key ~/.ssh/break_glass   # tests your enrolled key: one touch

Goes through what a signer and a run do: make a key as the README says, lint a
signers file holding it, sign a proof with break-glass-sign.py, verify it with
verify-proof/verify.py, then check that altered or misused copies of that proof are
rejected. Nothing is dispatched and nothing outside a temporary directory is
written; the throwaway key takes no storage on the YubiKey.
"""
import argparse
import importlib.util
import json
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
REPO, LOGIN = "test/test", "me"


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, os.path.join(HERE, path))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


helper = load("break_glass_sign", "break-glass-sign.py")
verifier = load("verify", "verify-proof/verify.py")


def step(title):
    print(f"\n== {title}")


def run(*cmd, **kw):
    res = subprocess.run(cmd, **kw)
    if res.returncode != 0:
        sys.exit(f"FAILED: {' '.join(cmd)}")
    return res


def main():
    p = argparse.ArgumentParser(description="Manual end-to-end test of the break-glass proof.")
    p.add_argument("--key", help="an enrolled sk- key handle to test, instead of a throwaway key")
    args = p.parse_args()

    with tempfile.TemporaryDirectory() as tmp:
        key = os.path.expanduser(args.key) if args.key else os.path.join(tmp, "key")
        if not args.key:
            step("1. Make a key on the YubiKey, as in the README (touch it when it blinks)")
            run(helper.ssh_keygen(), "-t", "ed25519-sk", "-N", "", "-C", "break-glass manual test",
                "-O", f"write-attestation={key}.att", "-f", key)
        else:
            step(f"1. Using the key {key}")
        with open(key + ".pub") as f:
            public = f.read().strip()
        print(public)

        step("2. Lint a signers file with that key")
        signers_path = os.path.join(tmp, "signers")
        with open(signers_path, "w") as f:
            f.write(f'{LOGIN} namespaces="break-glass" {public}\n')
        run(sys.executable, os.path.join(HERE, "lint-signers", "lint.py"), signers_path)
        with open(signers_path, "rb") as f:
            signers = f.read()

        step("3. Sign a proof (touch the YubiKey when it blinks)")
        proof = run(sys.executable, os.path.join(HERE, "break-glass-sign.py"), REPO,
                    "-f", "image_tag=v1.80.3", "-f", "terraform_ref=main", "--key", key,
                    stdout=subprocess.PIPE, text=True).stdout.strip()
        print(proof)

        step("4. Verify the proof")
        try:
            claims, key_type = verifier.verify(proof, signers, LOGIN, REPO, 600)
        except verifier.ProofError as e:
            sys.exit(f"FAILED: {e}")
        print(f"ok: {key_type} key, touched, signed {json.dumps(claims)}")

        step("5. Altered or misused copies of the proof must be rejected")
        doc = json.loads(proof)
        tampered = json.dumps({**doc, "payload": doc["payload"].replace("v1.80.3", "v1.80.4")})
        failed = False
        for name, kwargs in (
            ("payload changed after signing", dict(proof=tampered)),
            ("dispatched by another login", dict(actor="someone-else")),
            ("used in another repository", dict(repo="test/other")),
            ("expired", dict(max_age=-1)),
        ):
            kwargs = {"proof": proof, "signers": signers, "actor": LOGIN, "repo": REPO, "max_age": 600, **kwargs}
            try:
                verifier.verify(**kwargs)
            except verifier.ProofError as e:
                print(f"ok: {name}: {e}")
            else:
                print(f"FAILED: {name}: the proof was accepted")
                failed = True

    if failed:
        sys.exit(1)
    print("\nAll good: this YubiKey signs proofs that verify-proof accepts.")


if __name__ == "__main__":
    main()
