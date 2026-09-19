// The Argon2id derivation, in a Worker so the tab stays responsive
// through it (spec/ui/unlock.md, The derivation wait).
//
// It is the one expensive thing the browser does, about a sixth of a
// second on a computer and a little under two seconds on a phone, and
// it runs identically for both kinds of account: the page cannot know
// which it is authenticating as until it has, and must not
// (spec/architecture.md, Administrator credentials).
import loadArgon2id from '../vendor/argon2id/1.0.1/argon2id.js';

let argon2id = null;

self.onmessage = async (event) => {
  const { id, password, salt, kdf } = event.data;
  try {
    // The WebAssembly memory is allocated on first load. A device too
    // busy to give it up throws here, as an ordinary allocation
    // failure the caller can catch and report, rather than an opaque
    // trap (architecture.md, Key management).
    argon2id ??= await loadArgon2id();
    const raw = argon2id({
      password: new TextEncoder().encode(password),
      salt,
      parallelism: kdf.p,
      passes: kdf.t,
      memorySize: kdf.m,
      tagLength: 32,
    });
    self.postMessage({ id, ok: true, raw }, [raw.buffer]);
  } catch (error) {
    const outOfMemory =
      error instanceof RangeError || /memory|allocat/i.test(String(error));
    self.postMessage({ id, ok: false, outOfMemory, message: String(error) });
  }
};
