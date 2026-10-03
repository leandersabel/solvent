// A minimal Chrome DevTools Protocol driver: launch headless Chrome,
// open a page, evaluate, and read the console.
//
// No dependencies, because Node ships a WebSocket client and the
// browser this has to exercise is already installed. The screens are
// entirely client-rendered over WebCrypto and WebAssembly, so a real
// engine is the only place their acceptance criteria can be checked
// at all.
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Counts what a page has started and not finished: requests, and the
// WebCrypto calls every write passes through before it is sent. With
// the requests the browser reports, it is how a test knows a page has
// finished what an action started, instead of guessing how long that
// takes.
const ACTIVITY = `(() => {
  window.__busy = 0;
  const track = (owner, names) => {
    for (const name of names) {
      const original = owner[name];
      if (typeof original !== 'function') continue;
      owner[name] = function (...args) {
        window.__busy += 1;
        const result = original.apply(this, args);
        const done = () => { window.__busy -= 1; };
        Promise.resolve(result).then(done, done);
        return result;
      };
    }
  };
  track(window, ['fetch']);
  track(crypto.subtle, ['encrypt', 'decrypt', 'deriveBits', 'deriveKey', 'importKey', 'exportKey', 'digest', 'sign', 'verify', 'generateKey', 'wrapKey', 'unwrapKey']);
})();`;

const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const LAUNCH_TIMEOUT_MS = 60000;
const STDERR_KEEP = 32 * 1024;

// Chrome picks its own debugging port (port 0) and writes it to the
// profile's DevToolsActivePort, so no other process can hold it first.
// Its stderr is drained for its whole life into a bounded buffer: a
// full pipe would block Chrome, and the tail is what explains a launch
// that fails.
export async function launch() {
  const profile = mkdtempSync(join(tmpdir(), 'solvent-chrome-'));
  const child = spawn(CHROME, [
    '--headless=new',
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    // Chrome fetches its own components in the background, and those
    // downloads land wherever a test sends the downloads it triggers.
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-gpu',
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });

  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    stderr = (stderr + chunk).slice(-STDERR_KEEP);
  });

  let failure = null;
  child.once('error', (error) => {
    failure ??= `Chrome could not start: ${error.message}`;
  });
  child.once('exit', (code, signal) => {
    failure ??= `Chrome exited before it was ready (code ${code}, signal ${signal})`;
  });

  const nap = () => new Promise((r) => setTimeout(r, 150));
  const fail = async (message) => {
    child.kill('SIGKILL');
    // Let the pipe deliver what was written before the process went.
    await new Promise((r) => setTimeout(r, 50));
    throw new Error(`${message}\nChrome stderr (tail):\n${stderr}`);
  };

  const deadline = Date.now() + LAUNCH_TIMEOUT_MS;
  let port = null;
  let target = null;
  while (Date.now() < deadline) {
    if (failure) return fail(failure);
    if (port === null) {
      try {
        const first = readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0].trim();
        const value = Number(first);
        if (/^\d+$/.test(first) && value >= 1 && value <= 65535) port = value;
      } catch {}
    }
    if (port !== null) {
      try {
        const list = await fetch(`http://127.0.0.1:${port}/json/list`, {
          signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())),
        }).then((r) => r.json());
        target = list.find((t) => t.type === 'page');
        if (target) return { child, port, target };
      } catch {}
    }
    await nap();
  }
  if (failure) return fail(failure);
  return fail(`Chrome did not come up within ${LAUNCH_TIMEOUT_MS / 1000} s`);
}

export class Session {
  constructor(socket) {
    this.socket = socket;
    this.next = 0;
    this.pending = new Map();
    this.events = [];
    this.handlers = [];
    // Requests sent and not yet answered, once Network is enabled.
    this.inflight = new Map();
    this.drained = [];
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== undefined) {
        const entry = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (!entry) return;
        if (message.error) entry.reject(new Error(JSON.stringify(message.error)));
        else entry.resolve(message.result);
        return;
      }
      this.events.push(message);
      this.#track(message);
      for (const handler of this.handlers) handler(message);
    });
  }

  #track({ method, params }) {
    // A worker's script is left out: terminated before it loads, it is
    // never reported finished.
    if (method === 'Network.requestWillBeSent' && params.type !== 'Script') this.inflight.set(params.requestId, params.request.url);
    // What the document that has just gone was still loading is never
    // reported finished.
    if (method === 'Page.frameNavigated' && !params.frame.parentId) {
      this.inflight.clear();
      for (const done of this.drained.splice(0)) done();
    }
    if (method === 'Network.loadingFinished' || method === 'Network.loadingFailed') {
      this.inflight.delete(params.requestId);
      if (!this.inflight.size) for (const done of this.drained.splice(0)) done();
    }
  }

  static async connect(target) {
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true });
      socket.addEventListener('error', reject, { once: true });
    });
    return new Session(socket);
  }

  send(method, params = {}) {
    const id = ++this.next;
    this.socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }

  on(handler) {
    this.handlers.push(handler);
  }

  async goto(url) {
    const loaded = this.waitFor('Page.loadEventFired');
    await this.send('Page.navigate', { url });
    await loaded;
    await this.idle();
  }

  waitFor(method, timeout = 30000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.handlers = this.handlers.filter((h) => h !== handler);
        reject(new Error(`timed out waiting for ${method}`));
      }, timeout);
      const handler = (message) => {
        if (message.method !== method) return;
        clearTimeout(timer);
        this.handlers = this.handlers.filter((h) => h !== handler);
        resolve(message.params);
      };
      this.on(handler);
    });
  }

  async eval(expression, { awaitPromise = true } = {}) {
    return this.#value(await this.send('Runtime.evaluate', {
      expression,
      awaitPromise,
      returnByValue: true,
      userGesture: true,
    }));
  }

  // Runs a function in the page with its arguments as data, so a value
  // never becomes part of the code's text.
  async call(fn, ...args) {
    const { result: global } = await this.send('Runtime.evaluate', { expression: 'globalThis' });
    return this.#value(await this.send('Runtime.callFunctionOn', {
      objectId: global.objectId,
      functionDeclaration: fn.toString(),
      arguments: args.map((value) => ({ value })),
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    }));
  }

  #value(result) {
    if (result.exceptionDetails) {
      throw new Error(
        result.exceptionDetails.exception?.description ||
          JSON.stringify(result.exceptionDetails),
      );
    }
    return result.result.value;
  }

  // Real input at screen coordinates, which is hit-tested like a
  // person's: whatever is on top at (x, y) receives it. A scripted
  // element.click() skips that, and so passes with the control covered.
  async mouseClick(x, y) {
    const at = { x, y, button: 'left', clickCount: 1 };
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...at });
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...at });
  }

  async tap(x, y) {
    await this.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await this.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  }

  async key(name, { shift = false } = {}) {
    const keys = {
      Tab: { code: 'Tab', windowsVirtualKeyCode: 9 },
      Enter: { code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' },
      Escape: { code: 'Escape', windowsVirtualKeyCode: 27 },
    };
    const { text, ...rest } = keys[name];
    const modifiers = shift ? 8 : 0;
    await this.send('Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', key: name, text, modifiers, ...rest });
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', key: name, modifiers, ...rest });
  }

  // `n` animation frames, which is when a layout or a render the page
  // was just asked for has been drawn.
  frames(n = 2) {
    return this.eval(`new Promise((done) => {
      let left = ${Number(n)};
      const next = () => {
        if (--left <= 0) return done(true);
        frame(next);
      };
      // A page the browser is not drawing runs no frames, so a timer
      // stands in for one.
      const frame = (then) => {
        let called = false;
        const once = () => called || ((called = true), then());
        requestAnimationFrame(once);
        setTimeout(once, 100);
      };
      frame(next);
    })`);
  }

  // Starts counting what the page does, for `idle`. Applies to every
  // document the session loads from here on, and needs Network enabled.
  async track() {
    await this.send('Page.addScriptToEvaluateOnNewDocument', { source: ACTIVITY });
  }

  // Waits until the page has finished what it was doing: no request in
  // flight, no WebCrypto call pending, and two frames drawn since, which
  // is when what a request brought has been rendered. A request a test
  // holds back on purpose keeps it from ever being idle.
  async idle(timeout = 30000) {
    const deadline = Date.now() + timeout;
    const busy = () => this.eval('window.__busy || 0').catch(() => 0);
    do {
      await this.frames(2);
      if (this.inflight.size) {
        await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error(`requests still in flight: ${[...this.inflight.values()].join(' ')}`)), Math.max(1, deadline - Date.now()));
          this.drained.push(() => {
            clearTimeout(timer);
            resolve();
          });
        });
      }
      if (await busy()) await this.waitUntil('!window.__busy', { timeout: Math.max(1, deadline - Date.now()), label: 'the page to finish' });
    } while (this.inflight.size || (await busy()));
  }

  // `waitUntil` for a step the check is made of: false when the
  // condition never held, so a failure is one failed check and the part
  // goes on.
  holds(condition, options) {
    return this.waitUntil(condition, options).then(() => true, () => false);
  }

  // Waits for the condition to hold, polled inside the page every few
  // milliseconds, so the wait ends as soon as it becomes true. The
  // condition is an expression, or a function run with `args` as data. A
  // document that goes away mid-wait is waited for again.
  async waitUntil(condition, { args = [], timeout = 30000, label = condition } = {}) {
    const deadline = Date.now() + timeout;
    // Either may be asynchronous, so a condition can import a module.
    const source = typeof condition === 'function' ? `(${condition.toString()})(...args)` : `(async () => Boolean(${condition}))()`;
    let failure = null;
    while (Date.now() < deadline) {
      try {
        const { result } = await this.send('Runtime.evaluate', { expression: 'globalThis' });
        const met = this.#value(await this.send('Runtime.callFunctionOn', {
          objectId: result.objectId,
          functionDeclaration: `function (args, slice) {
            return new Promise((resolve) => {
              const end = performance.now() + slice;
              const tick = async () => {
                let met = false;
                try { met = Boolean(await ${source}); } catch (error) { globalThis.__waitFailure = String(error); }
                if (met || performance.now() > end) {
                  resolve(met);
                  return;
                }
                setTimeout(tick, 10);
              };
              tick();
            });
          }`,
          arguments: [{ value: args }, { value: Math.max(1, Math.min(2000, deadline - Date.now())) }],
          awaitPromise: true,
          returnByValue: true,
          userGesture: true,
        }));
        if (met) return true;
      } catch (error) {
        failure = error.message;
        if (!/context|destroyed|navigat|Inspected target|Cannot find/i.test(failure)) throw error;
        await this.waitFor('Runtime.executionContextCreated', 2000).catch(() => {});
      }
    }
    const thrown = await this.eval('globalThis.__waitFailure ?? null').catch(() => null);
    throw new Error(`timed out waiting for ${label}${failure || thrown ? ` (${failure ?? thrown})` : ''}`);
  }
}
