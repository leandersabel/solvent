// Reviewer's checks of "Something else…" offering a listed symbol
// (spec/features/manage-accounts.md, Account form, Fields, Measured in,
// criteria 64 and 67), written from the spec without reading how the form
// is built. While the typed text matches a listed symbol ignoring case,
// after trimming, the form offers that symbol, and neither the consequence
// line nor "Not listed?" shows. Every keystroke and click is real input.
import { check, holdings, openHolding, page, run, sql, vaultOwner } from '../harness.mjs';

const CONSEQUENCE = 'You enter the price yourself each time you record a value.';
const NOT_LISTED = 'Not listed?';
const RETIRED = 'XAG-ozt';
// An administrator's symbol whose label is markup: the offer of it is text.
const MARKED = 'ZZQ';
const XSS = '<img src=x onerror=alert(1)>';

const centerOf = (selector) =>
  page.call((query) => {
    const n = document.querySelector(query);
    n.scrollIntoView({ block: 'center' });
    const r = n.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, selector);
const press = async (selector) => {
  const { x, y } = await centerOf(selector);
  await page.mouseClick(x, y);
  await page.frames();
};
const backspace = async () => {
  const key = { key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 };
  await page.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...key });
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', ...key });
};
// Replaces what `selector` holds with `text`, typed.
const type = async (selector, text) => {
  await press(selector);
  await page.call((query) => document.querySelector(query).select(), selector);
  await backspace();
  if (text) await page.send('Input.insertText', { text });
  await page.frames();
};

// What a person reads, and what the form offers to use instead: a visible
// control outside the unit list that names the symbol.
const seen = (symbol) =>
  page.call((wanted) => {
    const shown = (n) => n.closest('[hidden], [aria-hidden=true]') === null && n.getBoundingClientRect().height > 0;
    const offers = [...document.querySelectorAll('button, a, [role=button]')]
      .filter((n) => shown(n) && !n.closest('#holding-unit-list') && n.textContent.includes(wanted))
      .map((n) => n.textContent.trim());
    return { text: document.body.innerText, offers };
  }, symbol);
const says = (state, line) => state.text.includes(line);
const offering = (state) => state.offers.length > 0 && !says(state, CONSEQUENCE) && !says(state, NOT_LISTED);
const freeText = (state) => state.offers.length === 0 && says(state, CONSEQUENCE) && says(state, NOT_LISTED);

const unitOf = (name) =>
  page.call(async (wanted) => {
    const v = (await import('/static/js/session.js')).currentVault();
    const h = [...v.holdings.values()].find((x) => x.payload.name === wanted);
    return h ? h.payload.unit : null;
  }, name);
const openAdd = async () => {
  await page.eval("location.hash = '#/'");
  await page.waitUntil("[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Add a holding')", { label: 'Add a holding' });
  await page.call(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Add a holding').click());
  await page.waitUntil("document.querySelector('#holding-name') && document.querySelector('.unit-option')", { label: 'the holding form' });
  await page.frames();
};

await run(async () => {
  sql('UPDATE symbols SET retired = 1 WHERE symbol = ?', RETIRED);
  sql("INSERT INTO symbols (symbol, label, kind, lookup) VALUES (?, ?, 'currency', 0)", MARKED, XSS);
  await vaultOwner();
  await page.call(() => { window.__alerted = false; window.alert = () => { window.__alerted = true; }; });

  await openAdd();
  await press('.unit-option.unit-other');
  let state = await seen('USD');
  check('review 67: Something else, opened empty, states the consequence and Not listed', says(state, CONSEQUENCE) && says(state, NOT_LISTED), state.text);

  await type('#holding-unit-other', 'bottles');
  state = await seen('bottles');
  check('review 67: free text matching nothing listed states the consequence and Not listed, and offers nothing', freeText(state), JSON.stringify(state.offers));

  // A listed symbol in any case, trimmed: a currency, the main currency,
  // a metal by its unit, and a listed symbol priced by hand.
  for (const [typed, symbol] of [['usd', 'USD'], ['Usd', 'USD'], ['  usd  ', 'USD'], ['chf', 'CHF'], ['xau-G', 'XAU-g'], ['XPT-G', 'XPT-g']]) {
    await type('#holding-unit-other', typed);
    state = await seen(symbol);
    check(
      `review 67: "${typed}" offers ${symbol}, and neither the consequence line nor Not listed shows`,
      offering(state),
      JSON.stringify({ offers: state.offers, consequence: says(state, CONSEQUENCE), notListed: says(state, NOT_LISTED) }),
    );
  }

  // A server-supplied label in the offer is text, never markup.
  await type('#holding-unit-other', MARKED.toLowerCase());
  state = await seen(MARKED);
  const built = await page.call(() => ({ img: document.querySelectorAll('img[src=x], img[src$="/x"]').length, alerted: window.__alerted }));
  check(`review 67: "${MARKED.toLowerCase()}" offers ${MARKED}`, offering(state), JSON.stringify(state.offers));
  check('review 67: offering a symbol whose label is markup builds no element from it', built.img === 0 && !built.alerted, JSON.stringify(built));

  // Typing on past the match is free text again.
  await type('#holding-unit-other', 'usd');
  await page.send('Input.insertText', { text: 't' });
  await page.frames();
  state = await seen('USD');
  check('review 67: typing on past a listed symbol brings back the consequence line and Not listed', freeText(state), JSON.stringify(state.offers));

  // Criterion 64: a retired symbol is refused, never offered.
  // A unit is refused on Save, with the name still empty so nothing is written.
  await type('#holding-unit-other', 'xag-OZT');
  await press('form button[type=submit]');
  await page.idle();
  state = await seen(RETIRED);
  check(
    'review 64: a retired symbol typed in any case is refused naming it, and not offered',
    says(state, `${RETIRED} is no longer offered for new holdings.`) && state.offers.length === 0,
    JSON.stringify(state.offers),
  );

  // Taking the offer saves the listed symbol, not the typed text.
  await type('#holding-name', 'Dollar cash');
  await type('#holding-unit-other', 'usd');
  const offered = await page.call(() => {
    const shown = (n) => n.closest('[hidden], [aria-hidden=true]') === null && n.getBoundingClientRect().height > 0;
    const n = [...document.querySelectorAll('button, a, [role=button]')]
      .find((b) => shown(b) && !b.closest('#holding-unit-list') && b.textContent.includes('USD'));
    if (!n) return false;
    n.setAttribute('data-review-offer', '');
    return true;
  });
  check('review 67: the offer can be taken', offered);
  if (offered) {
    await press('[data-review-offer]');
    state = await seen('USD');
    check('review 67: once USD is taken, the form no longer says its price is entered by hand', !says(state, CONSEQUENCE) && !says(state, NOT_LISTED), state.text);
    await press('form button[type=submit]');
    await page.idle();
    check('review 67: the holding saves in the offered USD', (await unitOf('Dollar cash')) === 'USD', String(await unitOf('Dollar cash')));
  }

  // The same control on the edit panel, of a holding with no values.
  const { 'Bond fund': bond } = await holdings([['Bond fund', 'CHF']]);
  await openHolding(bond);
  await page.call(() => [...document.querySelectorAll('button, a')].find((b) => b.textContent.trim() === 'Edit').click());
  await page.waitUntil("document.querySelector('#holding-name') && document.querySelector('.unit-option')", { label: 'the edit panel' });
  await page.frames();
  await press('.unit-option.unit-other');
  await type('#holding-unit-other', 'eur');
  state = await seen('EUR');
  check('review 67: on the edit panel, "eur" offers EUR without the consequence line or Not listed', offering(state), JSON.stringify(state.offers));
  await type('#holding-unit-other', 'm²');
  state = await seen('m²');
  check('review 67: on the edit panel, "m²" states the consequence line and Not listed again', freeText(state), JSON.stringify(state.offers));
}, { signsIn: false });
