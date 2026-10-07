// The vault form's no-recovery acknowledgement, written from
// spec/features/register.md (Register, The acknowledgement; acceptance
// criteria 33, 34 and 52) and design-system.md (Components, Callout;
// Accessibility) without reading how the form is built.
//
// The acknowledgement is a checkbox in a callout: the tinted fill, no
// border, 6px radius, 16px padding. The callout opens with the critical
// icon at the start of its first line, the icon alone in critical and
// the sentence in ink-primary. The checkbox is named by that sentence.
// With every other field ready, Create vault stays unusable and Enter
// derives and sends nothing until the box is ticked. The administrator
// form has no acknowledgement at all.
import { BASE, REGISTRANT_PASSWORD, check, mintInvite, page, run } from '../harness.mjs';

const COPY =
  'I understand that if I lose this password, my data is permanently unreadable. Solvent has no way to reset it or recover my vault.';
const TINTED = 'rgb(239, 247, 249)';
const CRITICAL = 'rgb(172, 49, 44)';
const INK_PRIMARY = 'rgb(17, 29, 32)';

const requests = [];
page.on((message) => {
  if (message.method === 'Network.requestWillBeSent') requests.push(message.params.request);
});
const sent = () => requests.filter((r) => r.method !== 'GET' || r.url.includes('kdf-worker')).map((r) => r.url);

// The callout holding the copy, as drawn: the nearest ancestor of the
// copy with the tinted fill, and what opens its first line.
const callout = () =>
  page.call(async (copy) => {
    const flat = (n) => n.textContent.replace(/\s+/g, ' ').trim();
    const holder = [...document.querySelectorAll('body *')].find(
      (n) => flat(n) === copy && ![...n.children].some((c) => flat(c) === copy),
    );
    if (!holder) return { found: false };
    let box = holder;
    while (box && getComputedStyle(box).backgroundColor !== 'rgb(239, 247, 249)') box = box.parentElement;
    if (!box) return { found: true, tinted: false };
    const style = getComputedStyle(box);
    // Everything drawn inside the callout, in document order: elements
    // with a box of their own, and each run of text by its own rects.
    const drawn = [];
    const walk = document.createTreeWalker(box, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      if (n.nodeType === Node.TEXT_NODE) {
        if (!n.textContent.trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(n);
        const rects = [...range.getClientRects()];
        if (rects.length) drawn.push({ kind: 'text', rect: rects[0], color: getComputedStyle(n.parentElement).color });
      } else if (['svg', 'img', 'input'].includes(n.localName) && n.getClientRects().length &&
        getComputedStyle(n).visibility !== 'hidden') {
        drawn.push({ kind: n.localName, node: n, rect: n.getBoundingClientRect() });
      }
    }
    const first = drawn[0] || null;
    const texts = drawn.filter((d) => d.kind === 'text');
    const firstLine = texts.length ? texts.reduce((a, b) => (b.rect.top < a.rect.top ? b : a)).rect : null;
    const inner = box.getBoundingClientRect();
    const padLeft = parseFloat(style.paddingLeft);
    const { icon } = await import('/static/js/dom.js');
    const critical = icon('alert');
    const svg = first && first.kind === 'svg' ? first.node : null;
    const checkbox = box.querySelector('input[type=checkbox]');
    return {
      found: true,
      tinted: true,
      border: [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth],
      radius: style.borderTopLeftRadius,
      padding: [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft],
      first: first && first.kind,
      // The same drawing as the app's critical icon, whatever its size.
      sameDrawing: Boolean(svg) && svg.getAttribute('viewBox') === critical.getAttribute('viewBox') &&
        svg.innerHTML === critical.innerHTML,
      iconColor: svg ? getComputedStyle(svg).color : null,
      iconStroke: svg ? getComputedStyle(svg).stroke : null,
      iconHidden: svg ? svg.getAttribute('aria-hidden') === 'true' : null,
      // At the start of the first line: flush with the content's left edge
      // and level with the first line of text.
      iconAtStart: Boolean(svg) && Math.abs(svg.getBoundingClientRect().left - (inner.left + padLeft)) <= 1,
      iconOnFirstLine: Boolean(svg && firstLine) &&
        svg.getBoundingClientRect().top < firstLine.bottom && svg.getBoundingClientRect().bottom > firstLine.top,
      textColors: [...new Set(texts.map((t) => t.color))],
      checkboxInside: Boolean(checkbox),
    };
  }, COPY);

const nameOfCheckbox = async () => {
  await page.send('Accessibility.enable');
  const { root } = await page.send('DOM.getDocument', { depth: 0 });
  const { nodeIds } = await page.send('DOM.querySelectorAll', { nodeId: root.nodeId, selector: 'input[type=checkbox]' });
  if (!nodeIds.length) return null;
  const { nodes } = await page.send('Accessibility.getPartialAXTree', { nodeId: nodeIds[0], fetchRelatives: false });
  return (nodes[0].name?.value ?? '').replace(/\s+/g, ' ').trim();
};

const disabled = () => page.eval("document.querySelector('button[type=submit]').disabled");

// Real input: a click where the node is drawn, a key through the
// browser's input pipeline.
const clickOn = async (selector) => {
  const { x, y } = await page.call((query) => {
    const node = document.querySelector(query);
    node.scrollIntoView({ block: 'center' });
    const r = node.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, selector);
  await page.mouseClick(x, y);
};
const pressEnter = async () => {
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' });
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
};

await run(async () => {
  await page.send('Network.enable');
  await page.goto(`${BASE}/register?invite=${mintInvite('vault-owner')}`);
  await page.idle();

  const shape = await callout();
  const seen = JSON.stringify(shape);
  check('review 52: the acknowledgement sits in a callout with the tinted fill', shape.found && shape.tinted, seen);
  check('review 52: the callout has no border, a 6px radius and 16px padding',
    shape.tinted && shape.border.every((w) => w === '0px') && shape.radius === '6px' &&
      shape.padding.every((p) => p === '16px'), seen);
  check('review 52: the callout opens with the critical icon', shape.first === 'svg' && shape.sameDrawing, seen);
  check('review 52: the icon sits at the start of the callout\'s first line', shape.iconAtStart && shape.iconOnFirstLine, seen);
  check('review 52: the icon is drawn in critical', shape.iconColor === CRITICAL &&
    [CRITICAL, 'currentcolor', 'currentColor'].includes(shape.iconStroke), seen);
  check('review 52: the sentence stays in ink-primary', shape.tinted && shape.textColors.length === 1 &&
    shape.textColors[0] === INK_PRIMARY, seen);
  check('review: the acknowledgement\'s checkbox is in the callout and named by the sentence alone',
    shape.checkboxInside && (await nameOfCheckbox()) === COPY, seen);

  // Every other field ready, the box unticked.
  await page.call((password) => {
    const set = (selector, value, index = 0) => {
      const node = document.querySelectorAll(selector)[index];
      node.value = value;
      node.dispatchEvent(new Event('input', { bubbles: true }));
      node.dispatchEvent(new Event('change', { bubbles: true }));
    };
    set('input[autocomplete="username"]', 'acknowledger');
    set('input[type=password]', password, 0);
    set('input[type=password]', password, 1);
  }, REGISTRANT_PASSWORD);
  await clickOn('#register-currency-list [data-symbol="CHF"]');
  await page.waitUntil("document.body.innerText.includes('Chosen: Swiss Franc (CHF)')", { label: 'the chosen currency' });
  check('review 33: with the acknowledgement unticked, Create vault is unusable', await disabled());

  const before = sent().length;
  for (const field of ['input[autocomplete="username"]', 'input[type=password]']) {
    await clickOn(field);
    await pressEnter();
  }
  await page.idle();
  check('review 33: Enter with the acknowledgement unticked derives nothing and sends nothing',
    sent().length === before, JSON.stringify(sent().slice(before)));

  await clickOn('input[type=checkbox]');
  await page.waitUntil("!document.querySelector('button[type=submit]').disabled", { label: 'the button, ticked' });
  await clickOn('input[type=checkbox]');
  check('review 33: unticking the acknowledgement makes Create vault unusable again', await disabled());

  // design-system.md, Accessibility: a phone is a supported target, so
  // the callout keeps its shape where the sentence wraps the most.
  await page.send('Emulation.setDeviceMetricsOverride', { width: 320, height: 800, deviceScaleFactor: 2, mobile: true });
  await page.idle();
  const phone = await callout();
  check('review 52: at phone width the callout still opens with the critical icon at the start of its first line, in critical',
    phone.first === 'svg' && phone.sameDrawing && phone.iconAtStart && phone.iconOnFirstLine && phone.iconColor === CRITICAL,
    JSON.stringify(phone));
  await page.send('Emulation.clearDeviceMetricsOverride');

  await page.goto(`${BASE}/register?invite=${mintInvite('administrator')}`);
  await page.idle();
  const admin = await page.call((copy) => ({
    checkbox: Boolean(document.querySelector('input[type=checkbox]')),
    copy: document.body.innerText.includes(copy),
    recovery: /recover/i.test(document.body.innerText),
  }), COPY);
  check('review 34: the administrator form has no acknowledgement and no claim about recovery',
    !admin.checkbox && !admin.copy && !admin.recovery, JSON.stringify(admin));
}, { signsIn: false });
