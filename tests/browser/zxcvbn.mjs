// The strength gauge's zxcvbn comes from strength.js alone
// (spec/features/register.md, zxcvbnLoading). A script source planted
// in the served registration page, as a JSON block and as data
// attributes, early and late in <body>, and an element named zxcvbn
// that clobbers window.zxcvbn, must change nothing about what loads.
// Run by tests/test_register_browser.py with the pinned path and hash.
import { launch, Session } from './cdp.mjs';

const { SOLVENT_BASE: BASE, SOLVENT_VAULT_INVITE: INVITE, PINNED_PATH, PINNED_SRI, PLANTED_PATH } = process.env;
const PASSWORD = 'harbour crescent tundra oblige';

const attribute = (value) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
const planting = [
  '<div id="zxcvbn"></div>',
  `<script id="zxcvbn-source" type="application/json">${JSON.stringify({ src: PLANTED_PATH, integrity: '' })}</script>`,
  ...['data-zxcvbn-src', 'data-src', 'data-zxcvbn'].map((name) => `<div ${name}="${attribute(PLANTED_PATH)}"></div>`),
].join('');

const { child, target } = await launch();
const page = await Session.connect(target);
await page.send('Page.enable');
await page.send('Runtime.enable');
await page.send('Network.enable');

const requested = [];
page.on((message) => {
  if (message.method === 'Network.requestWillBeSent') requested.push(new URL(message.params.request.url).pathname);
});
page.on(async (message) => {
  if (message.method !== 'Fetch.requestPaused') return;
  const { requestId, responseStatusCode, responseHeaders } = message.params;
  const { body, base64Encoded } = await page.send('Fetch.getResponseBody', { requestId });
  const html = (base64Encoded ? Buffer.from(body, 'base64').toString('utf8') : body)
    .replace(/<body([^>]*)>/, (_, rest) => `<body${rest} data-zxcvbn-src="${attribute(PLANTED_PATH)}">${planting}`)
    .replace('</body>', `${planting}</body>`);
  await page.send('Fetch.fulfillRequest', {
    requestId,
    responseCode: responseStatusCode,
    responseHeaders: responseHeaders.filter(({ name }) => name.toLowerCase() !== 'content-length'),
    body: Buffer.from(html).toString('base64'),
  });
});
await page.send('Fetch.enable', { patterns: [{ urlPattern: `${BASE}/register?*`, requestStage: 'Response' }] });

const checks = [];
const check = (name, condition, detail = '') => checks.push({ name, ok: Boolean(condition), detail: String(detail) });
try {
  await page.goto(`${BASE}/register?invite=${INVITE}`);
  check('the planting reached the page', await page.call(() => document.querySelectorAll('#zxcvbn-source').length === 2));
  await page.waitUntil(() => document.querySelector('input[type=password]') !== null, { label: 'the form' });
  await page.call((value) => {
    const input = document.querySelector('input[type=password]');
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, PASSWORD);
  await page.waitUntil(() => document.querySelectorAll('.gauge-segment.filled').length >= 4, { label: 'the gauge scoring' });

  const asked = requested.filter((path) => path.includes('zxcvbn'));
  check('only the pinned zxcvbn was requested, once', JSON.stringify(asked) === JSON.stringify([PINNED_PATH]), asked.join(' '));
  check('nothing planted was requested', !requested.includes(PLANTED_PATH));
  const integrity = await page.call(() => [...document.scripts].filter((s) => s.src.includes('/zxcvbn.js')).map((s) => s.integrity));
  check('the loading tag carries the pinned hash', JSON.stringify(integrity) === JSON.stringify([PINNED_SRI]), integrity.join(' '));
  check('the gauge scores with the real library', await page.call(() => typeof window.zxcvbn === 'function'));
} catch (error) {
  check('the checks ran to the end', false, error.message);
} finally {
  child.kill('SIGKILL');
}

for (const { name, ok, detail } of checks) console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ` (${detail})`}`);
process.exit(checks.every(({ ok }) => ok) ? 0 : 1);
