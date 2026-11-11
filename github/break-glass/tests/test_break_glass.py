"""Tests for break-glass-sign.py, verify-proof/verify.py and lint-signers/lint.py.

CI has no YubiKey, so SoftKey plays the authenticator: an sk-ssh-ed25519 key held in
a file, signing with the openssl CLI (OpenSSL 3) and setting the FIDO2 flags itself.

    python3 -m unittest discover -s github/break-glass/tests -v
"""
import base64
import hashlib
import importlib.util
import io
import json
import os
import re
import subprocess
import sys
import tempfile
import time
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parent.parent
REPO = "acme/app"
SK_ED25519 = b"sk-ssh-ed25519@openssh.com"


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, ROOT / path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


verifier = load("verify", "verify-proof/verify.py")
linter = load("lint", "lint-signers/lint.py")


def string(b):
    return len(b).to_bytes(4, "big") + b


class SoftKey:
    """A software sk-ssh-ed25519 key: what a FIDO2 authenticator does, without the device."""

    def __init__(self, directory, name):
        self.pem = str(Path(directory) / f"{name}.pem")
        subprocess.run(["openssl", "genpkey", "-algorithm", "ed25519", "-out", self.pem], check=True)
        der = subprocess.run(["openssl", "pkey", "-in", self.pem, "-pubout", "-outform", "DER"],
                             check=True, capture_output=True).stdout
        self.blob = string(SK_ED25519) + string(der[-32:]) + string(b"ssh:")
        self.public = f"{SK_ED25519.decode()} {base64.b64encode(self.blob).decode()}"

    def proof(self, payload, flags=0x05, namespace=b"break-glass", sig_type=SK_ED25519):
        """A proof over the payload string; flags 0x01 = touched, 0x04 = PIN entered."""
        signed = b"SSHSIG" + string(namespace) + string(b"") + string(b"sha512") \
            + string(hashlib.sha512(payload.encode()).digest())
        counter = (7).to_bytes(4, "big")
        to_sign = hashlib.sha256(b"ssh:").digest() + bytes([flags]) + counter + hashlib.sha256(signed).digest()
        Path(self.pem + ".in").write_bytes(to_sign)  # openssl 3.0 signs raw input only from a file
        sig = subprocess.run(["openssl", "pkeyutl", "-sign", "-rawin", "-inkey", self.pem, "-in", self.pem + ".in"],
                             check=True, capture_output=True).stdout
        blob = b"SSHSIG" + (1).to_bytes(4, "big") + string(self.blob) + string(namespace) + string(b"") \
            + string(b"sha512") + string(string(sig_type) + string(sig) + bytes([flags]) + counter)
        return json.dumps({"payload": payload, "sig": base64.b64encode(blob).decode()})


def claims(**kw):
    return json.dumps({"aud": REPO, "iat": int(time.time()), **kw})


class BreakGlassTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.dir = Path(cls.tmp.name)
        cls.key, cls.other = SoftKey(cls.dir, "key"), SoftKey(cls.dir, "other")
        cls.plain = str(cls.dir / "plain")
        subprocess.run(["ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-f", cls.plain], check=True)
        cls.plain_public = Path(cls.plain + ".pub").read_text().strip()
        cls.signers = (f'alice namespaces="break-glass" {cls.key.public}\n'
                       f'alice namespaces="break-glass" {cls.plain_public}\n').encode()

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def verify(self, proof, actor="alice", max_age=600):
        return verifier.verify(proof, self.signers, actor, REPO, max_age)

    def rejects(self, proof, message, **kw):
        with self.assertRaises(verifier.ProofError) as cm:
            self.verify(proof, **kw)
        self.assertIn(message, str(cm.exception))

    # -- signature ------------------------------------------------------------------
    def test_valid_proof(self):
        got, key_type = self.verify(self.key.proof(claims(image_tag="v1.80.3", ticket='INC-1 "q" $(x) ü')))
        self.assertEqual(key_type, "sk-ssh-ed25519@openssh.com")
        self.assertEqual(got["image_tag"], "v1.80.3")
        self.assertEqual(got["ticket"], 'INC-1 "q" $(x) ü')

    def test_any_payload_formatting_verifies(self):
        self.verify(self.key.proof(json.dumps(json.loads(claims(x="ü")), indent=2, ensure_ascii=False)))

    def test_sig_with_line_breaks_verifies(self):
        doc = json.loads(self.key.proof(claims()))
        doc["sig"] = "\n".join(doc["sig"][i:i + 70] for i in range(0, len(doc["sig"]), 70))
        self.verify(json.dumps(doc))

    def test_changed_payload_byte(self):
        doc = json.loads(self.key.proof(claims(image_tag="v1.80.3")))
        doc["payload"] = doc["payload"].replace("v1.80.3", "v1.80.4")
        self.rejects(json.dumps(doc), "does not verify")

    def test_dispatcher_is_not_the_signer(self):
        self.rejects(self.key.proof(claims()), "does not verify", actor="bob")

    def test_key_not_in_signers_file(self):
        self.rejects(self.other.proof(claims()), "does not verify")

    def test_wrong_namespace(self):
        self.rejects(self.key.proof(claims(), namespace=b"other"), "does not verify")

    def test_signed_without_touch_or_pin(self):
        for flags in (0x00, 0x01, 0x04):
            with self.subTest(flags=flags):
                self.rejects(self.key.proof(claims(), flags=flags), "without a touch and PIN")

    def test_other_signature_type(self):
        # Such a signature may carry more than flags and counter after the signature.
        self.rejects(self.key.proof(claims(), sig_type=b"webauthn-sk-ecdsa-sha2-nistp256@openssh.com"), "does not")

    # -- envelope and claims --------------------------------------------------------------
    def test_proof_not_json(self):
        for proof in ("garbage", "", '{"payload":"{}"}', '["payload","sig"]'):
            with self.subTest(proof=proof):
                self.rejects(proof, "is not {")

    def test_sig_not_ssh_signature(self):
        self.rejects(json.dumps({"payload": claims(), "sig": "bm90IGEgc2ln"}), "does not verify")

    def test_aud(self):
        self.verify(self.key.proof(claims(aud="Acme/App")))
        self.rejects(self.key.proof(claims(aud="acme/other")), "signed for 'acme/other'")
        self.rejects(self.key.proof(json.dumps({"iat": int(time.time())})), "signed for 'None'")

    def test_iat(self):
        now = int(time.time())
        self.verify(self.key.proof(claims(iat=now - 590)))
        self.verify(self.key.proof(claims(iat=now + 100)))
        self.rejects(self.key.proof(claims(iat=now - 601)), "more than the 600s")
        self.rejects(self.key.proof(claims(iat=now - 61)), "more than the 60s", max_age=60)
        self.rejects(self.key.proof(claims(iat=now + 300)), "in the future")
        for iat in (str(now), float(now), True, None):
            with self.subTest(iat=iat):
                self.rejects(self.key.proof(claims(iat=iat)), "no whole-number iat")

    def test_payload_not_a_json_object(self):
        self.rejects(self.key.proof("[1]"), "not a JSON object")
        self.rejects(self.key.proof("break-glass:acme/app:tag:v1"), "not JSON")

    # -- main(): the action's own checks ----------------------------------------------------
    def run_main(self, proof=None, signers=None, **env):
        out, summary = self.dir / "out", self.dir / "summary"
        out.write_text("")
        env = {"REPO": REPO, "REF": "refs/heads/main", "DEFAULT_BRANCH": "main", "ACTOR": "alice",
               "TRIGGERING_ACTOR": "alice", "PROOF": proof or self.key.proof(claims(image_tag="v1")),
               "SIGNERS_PATH": ".github/break-glass-signers", "MAX_AGE": "600", "GH_TOKEN": "t",
               "GITHUB_API_URL": "https://api", "GITHUB_OUTPUT": str(out), "GITHUB_STEP_SUMMARY": str(summary),
               **env}
        with mock.patch.dict(os.environ, env, clear=True), redirect_stdout(io.StringIO()), \
                mock.patch.object(verifier, "fetch_signers",
                                  return_value=self.signers if signers is None else signers) as fetch:
            verifier.main()
        fetch.assert_called_once_with("https://api", "t", REPO, ".github/break-glass-signers", "main")
        return dict(line.split("=", 1) for line in out.read_text().splitlines())

    def main_rejects(self, message, **kw):
        with self.assertRaises(verifier.ProofError) as cm:
            self.run_main(**kw)
        self.assertIn(message, str(cm.exception))

    def test_main_outputs(self):
        out = self.run_main()
        self.assertEqual(json.loads(out["payload"])["image_tag"], "v1")
        self.assertEqual((out["signer"], out["key-type"]), ("alice", "sk-ssh-ed25519@openssh.com"))

    def test_main_rejections(self):
        self.main_rejects("can only be re-run by its dispatcher", TRIGGERING_ACTOR="bob")
        self.main_rejects("runs only on main", REF="refs/heads/feature")
        self.main_rejects("is not {", PROOF=" ")
        self.main_rejects("whole seconds", MAX_AGE="10m")
        self.main_rejects("not found on main", signers=b"")

    # -- the helper --------------------------------------------------------------------------
    def helper(self, *args):
        return subprocess.run([sys.executable, str(ROOT / "break-glass-sign.py"), *args, "--key", self.plain],
                              capture_output=True, text=True)

    def test_helper_proof(self):
        """The helper signs with ssh-keygen, so with a plain key here: right up to the sk- check."""
        res = self.helper("Acme/App", "-f", "image_tag=v1.80.3", "-f", 'ticket=INC-1 "q" $(x)')
        self.assertEqual(res.returncode, 0, res.stderr)
        payload = json.loads(json.loads(res.stdout)["payload"])
        self.assertEqual(list(payload), ["aud", "iat", "image_tag", "ticket"])
        self.assertEqual((payload["aud"], payload["ticket"]), ("Acme/App", 'INC-1 "q" $(x)'))
        self.assertLessEqual(abs(payload["iat"] - time.time()), 5)
        self.rejects(res.stdout, "non-FIDO2 key (ssh-ed25519)")  # so the signature itself verified

    def test_helper_does_not_sign_through_an_agent(self):
        agent = subprocess.run(["ssh-agent", "-s"], check=True, capture_output=True, text=True).stdout
        env = {**os.environ, **dict(re.findall(r"(SSH_\w+)=([^;]+);", agent)),
               "SSH_ASKPASS": "false", "SSH_ASKPASS_REQUIRE": "force"}
        try:
            # -c: the agent must confirm each signature, and here it cannot, so it refuses.
            subprocess.run(["ssh-add", "-q", "-c", self.plain], check=True, env=env)
            with mock.patch.dict(os.environ, env):
                self.assertEqual(self.helper(REPO, "-f", "a=1").returncode, 0)
        finally:
            subprocess.run(["ssh-agent", "-k"], env=env, capture_output=True)

    def test_helper_argument_errors(self):
        for args in (["-f", "aud=x"], ["-f", "iat=1"], ["-f", "a=1", "-f", "a=2"], [], ["-f", "novalue"],
                     ["-f", "=x"]):
            with self.subTest(args=args):
                res = self.helper(REPO, *args)
                self.assertNotEqual(res.returncode, 0)
                self.assertEqual(res.stdout, "")
        self.assertNotEqual(self.helper("app", "-f", "a=1").returncode, 0)

    # -- lint-signers ------------------------------------------------------------------------
    def test_lint(self):
        sk = self.key.public
        cases = {
            "": (0, 0),
            "# comment\n\n": (0, 0),
            f'alice namespaces="break-glass" {sk} yubikey\n': (0, 1),
            f'alice namespaces="break-glass,other x" {sk}\n': (0, 1),
            f"alice {sk}\n": (0, 1),
            f'alice namespaces="break-glass" {self.plain_public}\n': (1, 1),
            'alice namespaces="break-glass" sk-ssh-ed25519@openssh.com AAAAnotakey\n': (1, 1),
            f'* namespaces="break-glass" {sk}\n': (1, 1),
            f'!bob,* namespaces="break-glass" {sk}\n': (1, 1),
            f'al?ce namespaces="break-glass" {sk}\n': (1, 1),
            "alice\n": (1, 1),
        }
        path = self.dir / "lint-signers"
        for text, expected in cases.items():
            with self.subTest(text=text):
                path.write_text(text)
                with redirect_stdout(io.StringIO()):
                    errors, keys = linter.lint(str(path))
                self.assertEqual((len(errors), keys), expected, errors)


if __name__ == "__main__":
    unittest.main()
