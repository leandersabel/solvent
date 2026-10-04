// The sign-in wait (spec/features/login.md, Unlock): the time from
// submitting the card to the Auth Key leaving the browser is the same
// whoever is being signed in.
// Templates: shell/. Modules: unlock.js, session.js, crypto.js,
// kdf-worker.js.
import { BASE, VAULT_PASSWORD, Session, administrator, check, launch, run, vaultOwner } from '../harness.mjs';

// The sign-ins here are held back before the request, so none reaches
// the login endpoint.
await run(async () => {
  await administrator();
  await vaultOwner();

  // ---- The sign-in wait ---------------------------------------------------

  // login.md: the time from submitting the sign-in form to the Auth Key
  // leaving the browser is statistically indistinguishable for an
  // administrator, a vault owner and a stranger. The stopwatch runs in
  // the page, from the form's submit event to the call that hands the
  // login request to the network. That call is held back, so no
  // sampled attempt reaches the login endpoint or counts against an
  // account. The salt request goes out for real, because its answer is
  // what the derivation runs on.
  //
  // The method is tests/test_timing.py's: one sign-in per case per
  // round in a fresh random order, the first round discarded because
  // it starts the worker and loads the WebAssembly, and every pair of
  // medians held within one interquartile range of a single sign-in.
  // The round count keeps the standard error of a median difference
  // at about a fifth of that range, so noise alone does not reach the
  // margin, while skipping the derivation for one case moves its
  // median by the whole derivation.
  const timing = await launch();
  try {
    const clean = await Session.connect(timing.target);
    await clean.send('Page.enable');
    await clean.send('Runtime.enable');
    await clean.goto(`${BASE}/login`);
    await clean.eval(`(() => {
      window.__waits = [];
      let started = 0;
      document.addEventListener('submit', () => { started = performance.now(); }, true);
      const send = window.fetch;
      window.fetch = (input, init) => {
        if (String(input).endsWith('/api/auth/login')) {
          window.__waits.push(performance.now() - started);
          return Promise.reject(new TypeError('held back by the timing harness'));
        }
        return send(input, init);
      };
    })()`);
    const signIn = (username) =>
      clean.call(async (name, password) => {
        const set = (selector, value) => {
          const node = document.querySelector(selector);
          node.value = value;
          node.dispatchEvent(new Event('input', { bubbles: true }));
        };
        const before = window.__waits.length;
        set('#unlock-username', name);
        set('#unlock-password', password);
        const button = document.querySelector('button[type=submit]');
        button.click();
        while (window.__waits.length === before || button.disabled) {
          await new Promise((r) => setTimeout(r, 25));
        }
        return window.__waits[before];
      }, username, VAULT_PASSWORD);

    const cases = { 'vault owner': 'leander', administrator: 'ops.leander', unknown: 'nobody-at-all' };
    const waits = Object.fromEntries(Object.keys(cases).map((name) => [name, []]));
    const ROUNDS = 44;
    for (let round = 0; round <= ROUNDS; round++) {
      const order = Object.keys(cases).sort(() => Math.random() - 0.5);
      for (const name of order) {
        const wait = await signIn(cases[name]);
        if (round) waits[name].push(wait);
      }
    }

    const median = (values) => {
      const sorted = [...values].sort((a, b) => a - b);
      const middle = Math.floor(sorted.length / 2);
      return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
    };
    const iqr = (values) => {
      const sorted = [...values].sort((a, b) => a - b);
      const half = Math.floor(sorted.length / 2);
      return median(sorted.slice(sorted.length - half)) - median(sorted.slice(0, half));
    };
    const summary = Object.entries(waits)
      .map(([name, values]) => `${name} ${median(values).toFixed(1)} ms, spread ${iqr(values).toFixed(1)} ms`)
      .join(', ');
    console.log(`sign-in wait: ${summary}`);
    const names = Object.keys(waits);
    for (const [i, a] of names.entries()) {
      for (const b of names.slice(i + 1)) {
        const gap = Math.abs(median(waits[a]) - median(waits[b]));
        const spread = (iqr(waits[a]) + iqr(waits[b])) / 2;
        check(
          `the sign-in wait is the same for ${a} and ${b}`,
          gap <= spread,
          `${gap.toFixed(1)} ms apart against a spread of ${spread.toFixed(1)} ms, ${summary}`,
        );
      }
    }
  } finally {
    timing.child.kill();
  }
}, { signsIn: false });
