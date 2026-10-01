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
      for (const handler of this.handlers) handler(message);
    });
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
    await this.settle();
  }

  waitFor(method, timeout = 30000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timed out waiting for ${method}`)), timeout);
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
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise,
      returnByValue: true,
      userGesture: true,
    });
    if (result.exceptionDetails) {
      throw new Error(
        result.exceptionDetails.exception?.description ||
          JSON.stringify(result.exceptionDetails),
      );
    }
    return result.result.value;
  }

  settle(ms = 120) {
    return new Promise((r) => setTimeout(r, ms));
  }

  async waitUntil(expression, { timeout = 30000, label = expression } = {}) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (await this.eval(`Boolean(${expression})`)) return true;
      await this.settle(150);
    }
    throw new Error(`timed out waiting for ${label}`);
  }
}
