"""The run's certificate authority and the stand-in's certificate
(spec/features/nightly-harness.md, The run's certificate authority).

    python3 tools/nightly/ca.py <dir>

The CA vouches for the two provider names alone, for one day, and signs
once. Its key lives in a temporary directory that is deleted before the
script exits, whether or not signing succeeded.
"""
from __future__ import annotations

import os
import secrets
import shutil
import signal
import subprocess
import sys
import tempfile
from pathlib import Path

NAMES = ("api.frankfurter.dev", "api.nbp.pl")

CA_CONFIG = """\
[req]
distinguished_name = dn
prompt = no
[dn]
CN = Solvent nightly CA
[ext]
basicConstraints = critical, CA:TRUE, pathlen:0
keyUsage = critical, keyCertSign, cRLSign
subjectKeyIdentifier = hash
authorityKeyIdentifier = none
nameConstraints = critical, permitted;DNS:api.frankfurter.dev, permitted;DNS:api.nbp.pl, excluded;IP:0.0.0.0/0.0.0.0, excluded;IP:0:0:0:0:0:0:0:0/0:0:0:0:0:0:0:0
"""

LEAF_CONFIG = """\
[req]
distinguished_name = dn
prompt = no
[dn]
CN = api.frankfurter.dev
[ext]
basicConstraints = critical, CA:FALSE
keyUsage = critical, digitalSignature
extendedKeyUsage = serverAuth
subjectAltName = DNS:api.frankfurter.dev, DNS:api.nbp.pl
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid
"""


def openssl(*args: str) -> str:
    """An argument list, never a shell."""
    done = subprocess.run(
        ["openssl", *args], capture_output=True, text=True, check=True, timeout=60
    )
    return done.stdout


def serial() -> str:
    """128 random bits, never zero."""
    value = 0
    while value < 1 << 120:
        value = secrets.randbits(128)
    return f"0x{value:032x}"


def make(work: Path) -> None:
    (work / "ca.cnf").write_text(CA_CONFIG)
    (work / "leaf.cnf").write_text(LEAF_CONFIG)
    for name in ("ca", "leaf"):
        openssl("genpkey", "-algorithm", "EC", "-pkeyopt", "ec_paramgen_curve:P-256", "-out", str(work / f"{name}.key"))
    openssl(
        "req", "-new", "-x509", "-sha256", "-days", "1", "-set_serial", serial(),
        "-key", str(work / "ca.key"), "-config", str(work / "ca.cnf"), "-extensions", "ext",
        "-out", str(work / "ca.pem"),
    )
    openssl(
        "req", "-new", "-sha256", "-key", str(work / "leaf.key"),
        "-config", str(work / "leaf.cnf"), "-out", str(work / "leaf.csr"),
    )
    openssl(
        "x509", "-req", "-sha256", "-days", "1", "-set_serial", serial(),
        "-in", str(work / "leaf.csr"), "-CA", str(work / "ca.pem"), "-CAkey", str(work / "ca.key"),
        "-extfile", str(work / "leaf.cnf"), "-extensions", "ext", "-out", str(work / "leaf.pem"),
    )


def publish(work: Path, out: Path) -> None:
    ca = (work / "ca.pem").read_bytes()
    trust = out / "trust"
    trust.mkdir(parents=True)
    (out / "ca.pem").write_bytes(ca)
    (out / "leaf.pem").write_bytes((work / "leaf.pem").read_bytes())
    descriptor = os.open(out / "leaf.key", os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "wb") as key:
        key.write((work / "leaf.key").read_bytes())
    digest = openssl("x509", "-in", str(work / "ca.pem"), "-noout", "-subject_hash").strip()
    (trust / "ca-certificates.crt").write_bytes(ca)
    (trust / f"{digest}.0").write_bytes(ca)


def main(argv: "list[str]") -> int:
    if len(argv) != 2:
        print("usage: ca.py <dir>", file=sys.stderr)
        return 2
    out = Path(argv[1])
    if out.exists() and (not out.is_dir() or any(out.iterdir())):
        print(f"{out} must be empty or absent", file=sys.stderr)
        return 2
    existed = out.exists()
    # A signal unwinds through the cleanup below, so the keys never
    # outlive the script.
    for number in (signal.SIGTERM, signal.SIGINT):
        signal.signal(number, lambda signum, _frame: sys.exit(128 + signum))
    work = Path(tempfile.mkdtemp(prefix="solvent-ca-"))
    try:
        make(work)
        out.mkdir(parents=True, exist_ok=True)
        publish(work, out)
    except (subprocess.SubprocessError, OSError) as error:
        print(f"ca failed: {type(error).__name__}", file=sys.stderr)
        # Nothing half written stays behind.
        if not existed:
            shutil.rmtree(out, ignore_errors=True)
        return 1
    finally:
        shutil.rmtree(work, ignore_errors=True)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
