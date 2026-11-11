#!/usr/bin/env python3
"""Verify a break-glass proof (run by action.yml; see github/break-glass/README.md).

The proof is JSON: {"payload": "<JSON object, as a string>", "sig": "<SSHSIG body>"}.
The signature covers the exact UTF-8 bytes of the payload string. The payload must
carry aud (= the repository) and iat (unix seconds, at most max-age old and at most
max-skew in the future). Every other field belongs to the calling repository and is
passed through unchecked.

Python 3.9+, standard library only, plus ssh-keygen (OpenSSH 8.2+).
"""
import base64
import json
import os
import struct
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request

FIDO2_KEY_TYPES = ("sk-ssh-ed25519@openssh.com", "sk-ecdsa-sha2-nistp256@openssh.com")


class ProofError(Exception):
    pass


def parse_proof(proof):
    """Return (payload bytes, armored signature) from the proof text."""
    try:
        doc = json.loads(proof)
    except ValueError:
        doc = None
    if not (isinstance(doc, dict) and isinstance(doc.get("payload"), str) and isinstance(doc.get("sig"), str)):
        raise ProofError('the proof is not {"payload": "...", "sig": "..."}: '
                         "produce it with break-glass-sign.py and paste it whole")
    body = "".join(doc["sig"].split())
    lines = [body[i:i + 70] for i in range(0, len(body), 70)]
    armored = "-----BEGIN SSH SIGNATURE-----\n" + "\n".join(lines) + "\n-----END SSH SIGNATURE-----\n"
    return doc["payload"].encode("utf-8"), armored


def key_type(armored):
    """Key type of the public key embedded in an SSHSIG signature."""
    try:
        blob = base64.b64decode("".join(armored.split("-----")[2].split()), validate=True)
        if blob[:6] != b"SSHSIG":
            raise ValueError
        off = 10  # magic(6) + version(4)
        (klen,) = struct.unpack(">I", blob[off:off + 4])
        key = blob[off + 4:off + 4 + klen]
        (tlen,) = struct.unpack(">I", key[:4])
        return key[4:4 + tlen].decode("ascii")
    except (ValueError, IndexError, struct.error, UnicodeDecodeError):
        raise ProofError("the proof's signature is not an SSH signature")


def check_signature(signers_file, principal, namespace, payload, armored):
    with tempfile.TemporaryDirectory() as tmp:
        sig_path = os.path.join(tmp, "sig")
        with open(sig_path, "w") as f:
            f.write(armored)
        res = subprocess.run(
            ["ssh-keygen", "-Y", "verify", "-f", signers_file, "-I", principal, "-n", namespace, "-s", sig_path],
            input=payload, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
    if res.returncode != 0:
        raise ProofError(
            f"the proof does not verify for @{principal}; is @{principal}'s sk- key in the signers file "
            f"with principal '{principal}' (case-sensitive) and namespace '{namespace}'?")


def check_claims(payload, repo, now, max_age, max_skew):
    """Parse the signed payload and check aud and iat; returns the payload as a dict."""
    try:
        claims = json.loads(payload.decode("utf-8"))
    except ValueError:
        raise ProofError("the signed payload is not JSON")
    if not isinstance(claims, dict):
        raise ProofError("the signed payload is not a JSON object")
    aud = claims.get("aud")
    if aud != repo:
        raise ProofError(f"the proof was signed for '{aud if isinstance(aud, str) else '<no aud>'}', "
                         f"this run is in '{repo}'")
    iat = claims.get("iat")
    if not isinstance(iat, int) or isinstance(iat, bool):
        raise ProofError("the signed payload has no whole-number iat")
    if iat < now - max_age:
        raise ProofError(f"the proof was signed {now - iat}s ago, more than the {max_age}s allowed: "
                         "sign a new one and dispatch again")
    if iat > now + max_skew:
        raise ProofError(f"the proof is dated {iat - now}s in the future (more than {max_skew}s): "
                         "check the signing machine's clock")
    return claims


def verify(proof, signers_file, actor, repo, namespace, max_age, max_skew, now=None, allow_any_key=False):
    """Verify the proof; returns (claims, key type). allow_any_key is for tests only."""
    payload, armored = parse_proof(proof)
    check_signature(signers_file, actor, namespace, payload, armored)
    kt = key_type(armored)
    if kt not in FIDO2_KEY_TYPES and not allow_any_key:
        raise ProofError(f"the proof verified but with a non-FIDO2 key ({kt}); only sk- keys are accepted")
    claims = check_claims(payload, repo, int(time.time()) if now is None else now, max_age, max_skew)
    return claims, kt


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
        raise


def compact(obj):
    # ASCII-only and single-line, so it is safe in the name=value form of GITHUB_OUTPUT.
    return json.dumps(obj, separators=(",", ":"))


def main():
    env = os.environ
    repo, actor, branch = env["REPO"], env["ACTOR"], env["DEFAULT_BRANCH"]
    namespace = env["NAMESPACE"]
    try:
        max_age, max_skew = int(env["MAX_AGE"]), int(env["MAX_SKEW"])
        if max_age < 0 or max_skew < 0:
            raise ValueError
    except ValueError:
        raise ProofError("max-age and max-skew must be whole seconds")

    # Default branch only: a workflow copy on another branch must not be able to
    # deploy, whatever its own gates say.
    if env["REF"] != f"refs/heads/{branch}":
        raise ProofError(f"break-glass runs only on {branch} (this run is on {env['REF']})")
    # On a re-run, github.actor stays the original dispatcher and the proof input is
    # kept: only the dispatcher may re-run their own run (within the proof's max-age).
    if env["TRIGGERING_ACTOR"] != actor:
        raise ProofError(
            f"run attempt {env.get('RUN_ATTEMPT', '?')} was started by @{env['TRIGGERING_ACTOR']} but the proof "
            f"belongs to @{actor}; a break-glass run can only be re-run by its dispatcher. "
            "Dispatch a new run with your own proof.")
    proof = env.get("PROOF", "")
    if not proof.strip():
        raise ProofError("no proof: sign with break-glass-sign.py and paste its output into the 'proof' input")

    signers = fetch_signers(env.get("GITHUB_API_URL", "https://api.github.com"), env["GH_TOKEN"],
                            repo, env["SIGNERS_PATH"], branch)
    if not signers.strip():
        raise ProofError(f"signers file {env['SIGNERS_PATH']} not found on {branch}; "
                         "enrol keys first (see github/break-glass/README.md)")
    with tempfile.NamedTemporaryFile("wb", suffix=".signers") as f:
        f.write(signers)
        f.flush()
        now = int(time.time())
        claims, kt = verify(proof, f.name, actor, repo, namespace, max_age, max_skew, now=now)

    payload = compact(claims)
    print(f"proof verified: @{actor} signed {payload} with a {kt} key")
    if env.get("GITHUB_OUTPUT"):
        with open(env["GITHUB_OUTPUT"], "a") as out:
            out.write(f"payload={payload}\nsigner={actor}\nkey-type={kt}\n")
    if env.get("GITHUB_STEP_SUMMARY"):
        with open(env["GITHUB_STEP_SUMMARY"], "a") as out:
            out.write("### 🔐 Break-glass proof verified\n"
                      f"- Signer: @{actor} (`{kt}`), signed {now - claims['iat']}s before verification\n"
                      f"- Payload:\n```json\n{json.dumps(claims, indent=2)}\n```\n")


if __name__ == "__main__":
    try:
        main()
    except ProofError as e:
        print(f"::error::{e}")
        sys.exit(1)
