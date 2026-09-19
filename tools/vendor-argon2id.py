"""Rebuild the vendored argon2id browser bundle.

`npm pack argon2id` ships an ES module per source file plus two loose
.wasm binaries, which architecture.md, Supply chain will not have: every
browser dependency is self-hosted, version-pinned and SRI-hashed, and an
SRI hash covers one file. This flattens the package into one module with
both binaries inlined, and prints the hash to pin it with.

    python3 tools/vendor-argon2id.py <unpacked-package-dir>

Each source module keeps its own scope inside an IIFE: the two of them
declare some of the same helper names at top level, which is legal
across modules and not inside one.
"""
from __future__ import annotations

import base64
import hashlib
import pathlib
import re
import sys

VERSION = "1.0.1"
DEST = pathlib.Path(__file__).parent.parent / (
    f"solvent/static/vendor/argon2id/{VERSION}/argon2id.js"
)

HEADER = f"""// argon2id {VERSION} (npm `argon2id`, github.com/openpgpjs/argon2id), MIT.
// One ES module with both WebAssembly binaries inlined, built by
// tools/vendor-argon2id.py, which is the only thing that edits it.
// See SOURCE.txt for provenance and the pinned SRI hash.
"""

LOADER = """
function decodeWasm(b64) {
  const raw = atob(b64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

export default async function loadArgon2id() {
  return setupWasm(
    (imports) => WebAssembly.instantiate(decodeWasm(SIMD_WASM), imports),
    (imports) => WebAssembly.instantiate(decodeWasm(NO_SIMD_WASM), imports),
  );
}
"""


def scoped(source: str, export: str) -> str:
    """One module's body as an IIFE yielding its default export."""
    body = re.sub(r"^import .*\n", "", source, flags=re.MULTILINE)
    body = body.replace(f"export default function {export}", f"function {export}")
    return f"const {export} = (() => {{\n{body}\nreturn {export};\n}})();\n"


def main(pkg: pathlib.Path) -> None:
    blake = scoped(pkg.joinpath("lib/blake2b.js").read_text(), "createHash")
    argon = scoped(
        pkg.joinpath("lib/argon2id.js").read_text().replace("blake2b(", "createHash("),
        "argon2id",
    )
    setup = re.sub(
        r"^import .*\n", "", pkg.joinpath("lib/setup.js").read_text(), flags=re.MULTILINE
    ).replace("export default async function setupWasm", "async function setupWasm")

    def inline(name: str) -> str:
        blob = base64.b64encode(pkg.joinpath(f"dist/{name}.wasm").read_bytes()).decode()
        const = name.upper().replace("-", "_") + "_WASM"
        return f'const {const} = "{blob}";\n'

    bundle = "".join(
        [HEADER, blake, argon, setup, inline("simd"), inline("no-simd"), LOADER]
    )
    DEST.parent.mkdir(parents=True, exist_ok=True)
    DEST.write_text(bundle)

    digest = base64.b64encode(hashlib.sha384(bundle.encode()).digest()).decode()
    print(f"{DEST} ({len(bundle)} bytes)")
    print(f"sha384-{digest}")


if __name__ == "__main__":
    main(pathlib.Path(sys.argv[1]))
