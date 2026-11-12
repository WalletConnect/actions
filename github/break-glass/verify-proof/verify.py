#!/usr/bin/env python3
"""Verify a break-glass proof (run by action.yml; see github/break-glass/README.md).

The proof is JSON: {"payload": "<JSON object, as a string>", "sig": "<SSHSIG body>"}.
The signature covers the exact UTF-8 bytes of the payload string. The payload must
carry aud (= the repository) and iat (unix seconds, at most max-age old). Every other
field belongs to the calling repository and is passed through unchecked.

Python 3.9+, standard library only, plus ssh-keygen (OpenSSH 8.2+).
"""
import base64
import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request

NAMESPACE = "break-glass"
MAX_SKEW = 120  # seconds an iat may lie in the future, for a signing clock that runs ahead
FIDO2_KEY_TYPES = ("sk-ssh-ed25519@openssh.com", "sk-ecdsa-sha2-nistp256@openssh.com")
TOUCHED = 0x01  # FIDO2 flag: user present


class ProofError(Exception):
    pass


def ssh_strings(buf, n):
    """The first n length-prefixed strings of an SSH wire buffer, then what follows them."""
    out = []
    for _ in range(n):
        size = int.from_bytes(buf[:4], "big")
        out.append(buf[4:4 + size])
        buf = buf[4 + size:]
    return out + [buf]


def reject_constant(name):
    """Python's json also reads NaN and Infinity, which are not JSON and would not survive the output."""
    raise ValueError(name)


def verify(proof, signers, actor, repo, max_age):
    """Verify the proof against the signers file (bytes); returns (payload dict, key type)."""
    try:
        doc = json.loads(proof)
    except ValueError:
        doc = None
    if not (isinstance(doc, dict) and isinstance(doc.get("payload"), str) and isinstance(doc.get("sig"), str)):
        raise ProofError('the proof is not {"payload": "...", "sig": "..."}: '
                         "produce it with break-glass-sign.py and paste it whole")
    payload, sig = doc["payload"], "".join(doc["sig"].split())

    with tempfile.TemporaryDirectory() as tmp:
        signers_path, sig_path = os.path.join(tmp, "signers"), os.path.join(tmp, "sig")
        with open(signers_path, "wb") as f:
            f.write(signers)
        with open(sig_path, "w") as f:
            f.write(f"-----BEGIN SSH SIGNATURE-----\n{sig}\n-----END SSH SIGNATURE-----\n")
        res = subprocess.run(
            ["ssh-keygen", "-Y", "verify", "-f", signers_path, "-I", actor, "-n", NAMESPACE, "-s", sig_path],
            input=payload.encode("utf-8"), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    if res.returncode != 0:
        raise ProofError(f"the proof does not verify for @{actor}; is @{actor}'s sk- key in the signers file "
                         f"with principal '{actor}' (case-sensitive) and namespace '{NAMESPACE}'?")

    # ssh-keygen accepted the signature, so it is well-formed. It does not look at the
    # key type or at the FIDO2 touch flag, so read them from the SSHSIG blob:
    #   magic(6) version(4) string(publickey) string(namespace) string(reserved) string(hash) string(signature)
    #   publickey = string(type) ...        signature = string(type) string(sig) byte(flags) uint32(counter)
    publickey, _, _, _, signature, _ = ssh_strings(base64.b64decode(sig, validate=True)[10:], 5)
    key_type = ssh_strings(publickey, 1)[0].decode()
    sig_type, _, after_sig = ssh_strings(signature, 2)
    if key_type not in FIDO2_KEY_TYPES:
        raise ProofError(f"the proof verified but with a non-FIDO2 key ({key_type}); only sk- keys are accepted")
    if sig_type.decode() != key_type:  # e.g. a browser's webauthn- form, which ssh-keygen also accepts
        raise ProofError(f"the proof's signature type ({sig_type.decode()}) is not accepted; "
                         "sign with break-glass-sign.py")
    if not after_sig[0] & TOUCHED:
        raise ProofError("the proof was signed without the key being touched; "
                         "enrol a key made without -O no-touch-required (see github/break-glass/README.md)")

    # The payload is signed, so from here on it is the signer's statement.
    try:
        claims = json.loads(payload, parse_constant=reject_constant)
    except ValueError:
        raise ProofError("the signed payload is not JSON")
    if not isinstance(claims, dict):
        raise ProofError("the signed payload is not a JSON object")
    aud = claims.get("aud")
    if not isinstance(aud, str) or aud.lower() != repo.lower():  # GitHub names are case-insensitive
        raise ProofError(f"the proof was signed for {aud!r}, this run is in '{repo}'")
    iat, now = claims.get("iat"), int(time.time())
    if type(iat) is not int:
        raise ProofError("the signed payload has no whole-number iat")
    if iat < now - max_age:
        raise ProofError(f"the proof was signed {now - iat}s ago, more than the {max_age}s allowed: "
                         "sign a new one and dispatch again")
    if iat > now + MAX_SKEW:
        raise ProofError(f"the proof is dated {iat - now}s in the future (more than {MAX_SKEW}s): "
                         "check the signing machine's clock")
    return claims, key_type


def fetch_signers(api_url, token, repo, path, ref):
    """The signers file from `ref` through the API, never from the checkout."""
    url = f"{api_url}/repos/{repo}/contents/{urllib.parse.quote(path)}?ref={urllib.parse.quote(ref)}"
    req = urllib.request.Request(url, headers={
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github.raw+json",
        "X-GitHub-Api-Version": "2022-11-28",
    })
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return resp.read()
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return b""
        raise ProofError(f"reading {path} from {ref} failed with HTTP {e.code}; the token needs contents:read")


def main():
    env = os.environ
    repo, actor, branch = env["REPO"], env["ACTOR"], env["DEFAULT_BRANCH"]
    try:
        max_age = int(env["MAX_AGE"])
    except ValueError:
        raise ProofError("max-age must be whole seconds")
    # Default branch only: a workflow copy on another branch must not be able to
    # deploy, whatever its own gates say.
    if env["REF"] != f"refs/heads/{branch}":
        raise ProofError(f"break-glass runs only on {branch} (this run is on {env['REF']})")
    # On a re-run, github.actor stays the original dispatcher and the proof input is
    # kept: only the dispatcher may re-run their own run (within the proof's max-age).
    if env["TRIGGERING_ACTOR"] != actor:
        raise ProofError(f"this attempt was started by @{env['TRIGGERING_ACTOR']} but the proof belongs to "
                         f"@{actor}; a break-glass run can only be re-run by its dispatcher. "
                         "Dispatch a new run with your own proof.")
    signers = fetch_signers(env["GITHUB_API_URL"], env["GH_TOKEN"], repo, env["SIGNERS_PATH"], branch)
    if not signers.strip():
        raise ProofError(f"signers file {env['SIGNERS_PATH']} not found on {branch}; "
                         "enrol keys first (see github/break-glass/README.md)")

    claims, key_type = verify(env["PROOF"], signers, actor, repo, max_age)

    # json.dumps output is ASCII on a single line, so it is safe as name=value in GITHUB_OUTPUT.
    payload = json.dumps(claims, separators=(",", ":"))
    print(f"proof verified: @{actor} signed {payload} with a {key_type} key")
    with open(env["GITHUB_OUTPUT"], "a") as out:
        out.write(f"payload={payload}\nsigner={actor}\nkey-type={key_type}\n")
    with open(env["GITHUB_STEP_SUMMARY"], "a") as out:
        out.write("### 🔐 Break-glass proof verified\n"
                  f"- Signer: @{actor} (`{key_type}`, touched)\n"
                  f"- Payload:\n```json\n{json.dumps(claims, indent=2)}\n```\n")


if __name__ == "__main__":
    try:
        main()
    except ProofError as e:
        print(f"::error::{e}")
        sys.exit(1)
