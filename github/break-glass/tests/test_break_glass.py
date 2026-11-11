"""Tests for break-glass-sign.py, verify-proof/verify.py and lint-signers/lint.py.

CI has no YubiKey, so proofs are signed with throwaway plain ed25519 keys and the
sk- check is lifted through verify()'s test-only allow_any_key argument; main()
never passes it.

    python3 -m unittest discover -s github/break-glass/tests -v
"""
import base64
import importlib.util
import io
import json
import os
import struct
import subprocess
import sys
import tempfile
import time
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parent.parent


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, ROOT / path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


signer = load("break_glass_sign", "break-glass-sign.py")
verifier = load("verify", "verify-proof/verify.py")
linter = load("lint", "lint-signers/lint.py")

REPO = "acme/app"


def keygen(path, comment):
    subprocess.run(["ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-C", comment, "-f", str(path)], check=True)
    return Path(f"{path}.pub").read_text().strip()


class BreakGlassTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        d = Path(cls.tmp.name)
        cls.key, cls.other = str(d / "key"), str(d / "other")
        cls.pub, cls.other_pub = keygen(cls.key, "test"), keygen(cls.other, "other")
        cls.signers = d / "signers"
        cls.signers.write_text(f'alice namespaces="break-glass" {cls.pub}\n')

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    # -- helpers ---------------------------------------------------------------
    def helper(self, *args):
        return subprocess.run([sys.executable, str(ROOT / "break-glass-sign.py"), *args],
                              capture_output=True, text=True)

    def proof_for(self, payload, key=None, namespace="break-glass"):
        """A proof over an arbitrary payload string."""
        res = subprocess.run(["ssh-keygen", "-Y", "sign", "-n", namespace, "-f", key or self.key],
                             input=payload.encode(), capture_output=True, check=True)
        body = "".join(res.stdout.decode().strip().splitlines()[1:-1])
        return json.dumps({"payload": payload, "sig": body})

    def claims(self, **kw):
        c = {"aud": REPO, "iat": int(time.time())}
        c.update(kw)
        return json.dumps(c)

    def verify(self, proof, actor="alice", **kw):
        args = dict(signers_file=str(self.signers), actor=actor, repo=REPO, namespace="break-glass",
                    max_age=600, max_skew=120, allow_any_key=True)
        args.update(kw)
        return verifier.verify(proof, **args)

    def rejects(self, proof, message, **kw):
        with self.assertRaises(verifier.ProofError) as cm:
            self.verify(proof, **kw)
        self.assertIn(message, str(cm.exception))

    # -- helper + verify round trip -------------------------------------------------
    def test_helper_proof_verifies(self):
        res = self.helper(REPO, "-f", "image_tag=v1.80.3", "-f", "terraform_ref=main",
                          "-f", 'ticket=INC-1 "quoted" $(x)', "--key", self.key)
        self.assertEqual(res.returncode, 0, res.stderr)
        proof = res.stdout.strip()
        claims, kt = self.verify(proof)
        self.assertEqual(kt, "ssh-ed25519")
        self.assertEqual(claims["image_tag"], "v1.80.3")
        self.assertEqual(claims["terraform_ref"], "main")
        self.assertEqual(claims["ticket"], 'INC-1 "quoted" $(x)')
        self.assertEqual(claims["aud"], REPO)
        self.assertRegex(claims["nonce"], r"^[0-9a-f]{32}$")
        self.assertLessEqual(abs(claims["iat"] - time.time()), 5)
        self.assertEqual(json.loads(json.loads(proof)["payload"]), claims)

    def test_any_payload_formatting_verifies(self):
        self.verify(self.proof_for(json.dumps(json.loads(self.claims(x="ü")), indent=2, ensure_ascii=False)))

    def test_sig_with_line_breaks_verifies(self):
        doc = json.loads(self.proof_for(self.claims()))
        doc["sig"] = "\n".join(doc["sig"][i:i + 70] for i in range(0, len(doc["sig"]), 70))
        self.verify(json.dumps(doc))

    # -- signature ------------------------------------------------------------------
    def test_changed_payload_byte(self):
        doc = json.loads(self.proof_for(self.claims(image_tag="v1.80.3")))
        doc["payload"] = doc["payload"].replace("v1.80.3", "v1.80.4")
        self.rejects(json.dumps(doc), "does not verify")

    def test_dispatcher_is_not_the_signer(self):
        self.rejects(self.proof_for(self.claims()), "does not verify", actor="bob")

    def test_key_not_in_signers_file(self):
        self.rejects(self.proof_for(self.claims(), key=self.other), "does not verify")

    def test_wrong_namespace(self):
        self.rejects(self.proof_for(self.claims(), namespace="other"), "does not verify")

    def test_non_sk_key_rejected_outside_tests(self):
        self.rejects(self.proof_for(self.claims()), "non-FIDO2 key (ssh-ed25519)", allow_any_key=False)

    def test_sk_key_types_accepted(self):
        self.assertEqual(set(verifier.FIDO2_KEY_TYPES),
                         {"sk-ssh-ed25519@openssh.com", "sk-ecdsa-sha2-nistp256@openssh.com"})

    # -- envelope and claims --------------------------------------------------------------
    def test_proof_not_json(self):
        self.rejects("garbage", "is not {")

    def test_proof_missing_sig(self):
        self.rejects('{"payload":"{}"}', "is not {")

    def test_sig_not_ssh_signature(self):
        self.rejects(json.dumps({"payload": self.claims(), "sig": "bm90IGEgc2ln"}), "does not verify")

    def test_wrong_aud(self):
        self.rejects(self.proof_for(self.claims(aud="acme/other")), "signed for 'acme/other'")

    def test_missing_aud(self):
        self.rejects(self.proof_for(json.dumps({"iat": int(time.time())})), "signed for '<no aud>'")

    def test_iat_too_old(self):
        self.rejects(self.proof_for(self.claims(iat=int(time.time()) - 601)), "more than the 600s")

    def test_iat_inside_max_age(self):
        self.verify(self.proof_for(self.claims(iat=int(time.time()) - 590)))

    def test_iat_too_far_ahead(self):
        self.rejects(self.proof_for(self.claims(iat=int(time.time()) + 300)), "in the future")

    def test_iat_inside_max_skew(self):
        self.verify(self.proof_for(self.claims(iat=int(time.time()) + 100)))

    def test_iat_not_a_whole_number(self):
        for iat in (str(int(time.time())), time.time(), True, None):
            with self.subTest(iat=iat):
                self.rejects(self.proof_for(self.claims(iat=iat)), "no whole-number iat")

    def test_payload_not_an_object(self):
        self.rejects(self.proof_for("[1]"), "not a JSON object")

    def test_payload_not_json(self):
        self.rejects(self.proof_for("break-glass:acme/app:tag:v1"), "not JSON")

    # -- main(): the action's own checks ----------------------------------------------------
    def run_main(self, proof, **env):
        out = Path(self.tmp.name) / "out"
        out.write_text("")
        base = dict(REPO=REPO, REF="refs/heads/main", DEFAULT_BRANCH="main", ACTOR="alice",
                    TRIGGERING_ACTOR="alice", RUN_ATTEMPT="1", PROOF=proof, SIGNERS_PATH=".github/break-glass-signers",
                    NAMESPACE="break-glass", MAX_AGE="600", MAX_SKEW="120", GH_TOKEN="t", GITHUB_OUTPUT=str(out))
        base.update(env)
        real_verify = verifier.verify
        with mock.patch.dict(os.environ, base, clear=True), \
                mock.patch.object(verifier, "fetch_signers", return_value=self.signers.read_bytes()) as fetch, \
                mock.patch.object(verifier, "verify", lambda *a, **k: real_verify(*a, allow_any_key=True, **k)), \
                redirect_stdout(io.StringIO()):
            verifier.main()
        fetch.assert_called_once_with("https://api.github.com", "t", REPO, ".github/break-glass-signers", "main")
        return dict(line.split("=", 1) for line in out.read_text().splitlines())

    def main_rejects(self, message, proof=None, **env):
        with self.assertRaises(verifier.ProofError) as cm:
            self.run_main(proof or self.proof_for(self.claims()), **env)
        self.assertIn(message, str(cm.exception))

    def test_main_outputs(self):
        out = self.run_main(self.proof_for(self.claims(image_tag="v1")))
        self.assertEqual(json.loads(out["payload"])["image_tag"], "v1")
        self.assertEqual(out["signer"], "alice")
        self.assertEqual(out["key-type"], "ssh-ed25519")

    def test_main_rerun_by_dispatcher(self):
        self.run_main(self.proof_for(self.claims()), RUN_ATTEMPT="2")

    def test_main_rerun_by_someone_else(self):
        self.main_rejects("can only be re-run by its dispatcher", TRIGGERING_ACTOR="bob", RUN_ATTEMPT="2")

    def test_main_other_branch(self):
        self.main_rejects("runs only on main", REF="refs/heads/feature")

    def test_main_empty_proof(self):
        self.main_rejects("no proof", proof=" ")

    def test_main_bad_max_age(self):
        self.main_rejects("whole seconds", MAX_AGE="10m")

    def test_main_never_allows_any_key(self):
        base = dict(REPO=REPO, REF="refs/heads/main", DEFAULT_BRANCH="main", ACTOR="alice", TRIGGERING_ACTOR="alice",
                    PROOF=self.proof_for(self.claims()), SIGNERS_PATH="s", NAMESPACE="break-glass",
                    MAX_AGE="600", MAX_SKEW="120", GH_TOKEN="t")
        with mock.patch.dict(os.environ, base, clear=True), \
                mock.patch.object(verifier, "fetch_signers", return_value=self.signers.read_bytes()), \
                self.assertRaises(verifier.ProofError) as cm:
            verifier.main()
        self.assertIn("non-FIDO2", str(cm.exception))

    def test_main_missing_signers_file(self):
        with mock.patch.object(verifier, "fetch_signers", return_value=b""):
            base = dict(REPO=REPO, REF="refs/heads/main", DEFAULT_BRANCH="main", ACTOR="alice",
                        TRIGGERING_ACTOR="alice", PROOF="x", SIGNERS_PATH="s", NAMESPACE="break-glass",
                        MAX_AGE="600", MAX_SKEW="120", GH_TOKEN="t")
            with mock.patch.dict(os.environ, base, clear=True), self.assertRaises(verifier.ProofError) as cm:
                verifier.main()
        self.assertIn("not found on main", str(cm.exception))

    # -- helper arguments -----------------------------------------------------------------
    def test_helper_argument_errors(self):
        for args in (["-f", "aud=x"], ["-f", "nonce=x"], ["-f", "a=1", "-f", "a=2"], [], ["-f", "novalue"],
                     ["-f", "=x"]):
            with self.subTest(args=args):
                res = self.helper(REPO, *args, "--key", self.key)
                self.assertNotEqual(res.returncode, 0)
                self.assertEqual(res.stdout, "")
        self.assertNotEqual(self.helper("app", "-f", "a=1", "--key", self.key).returncode, 0)
        self.assertNotEqual(self.helper(REPO, "-f", "a=1", "--key", "/nonexistent").returncode, 0)

    def test_helper_payload_order(self):
        payload = signer.build_payload(REPO, {"image_tag": "v1"}, now=1, nonce="n")
        self.assertEqual(payload, '{"aud":"acme/app","iat":1,"nonce":"n","image_tag":"v1"}')

    # -- lint-signers ------------------------------------------------------------------------
    def lint(self, text):
        path = Path(self.tmp.name) / "lint-signers"
        path.write_text(text)
        with redirect_stdout(io.StringIO()):
            return linter.lint(str(path))

    def test_lint(self):
        # A well-formed sk-ssh-ed25519 public key (no device needed to parse one).
        def string(b):
            return struct.pack(">I", len(b)) + b
        blob = string(b"sk-ssh-ed25519@openssh.com") + string(os.urandom(32)) + string(b"ssh:")
        sk = f"sk-ssh-ed25519@openssh.com {base64.b64encode(blob).decode()} yubikey"
        cases = {
            "": (0, 0),
            "# comment\n\n": (0, 0),
            f'alice namespaces="break-glass" {sk}\n': (0, 1),
            f'alice namespaces="break-glass,other x" {sk}\n': (0, 1),
            f"alice {sk}\n": (0, 1),
            f'alice namespaces="break-glass" {self.pub}\n': (1, 1),
            'alice namespaces="break-glass" sk-ssh-ed25519@openssh.com AAAAnotakey\n': (1, 1),
            "alice\n": (1, 1),
        }
        for text, (errors, keys) in cases.items():
            with self.subTest(text=text):
                errs, n = self.lint(text)
                self.assertEqual((len(errs), n), (errors, keys), errs)


if __name__ == "__main__":
    unittest.main()
