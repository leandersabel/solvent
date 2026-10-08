// The ERASE field's refusal, written from spec/features/export-import.md
// (Import step 4, criterion 22) and spec/design-system.md (Components,
// Input, The message line) without reading how the screen is built.
//
// Into a vault with records, Replace my vault without the typed ERASE
// sends nothing and changes nothing. The refusal is the field's own: on
// the message line its aria-describedby names, a polite live region,
// with aria-invalid="true", shown nowhere else, and without moving the
// button. Typing ERASE returns the line to its hint at once, with no
// second press.
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  BASE, OWN, VAULT_PASSWORD, check, enterPassword, holdings, page, recording, run, setValue, sql, vaultOwner, watched,
  within,
} from '../harness.mjs';

const DIR = mkdtempSync(join(tmpdir(), 'solvent-review-erase-'));
const REPLACE = 'Replace my vault';

const unlockScreen = async () => {
  await page.goto(`${BASE}/settings/export-import`);
  await enterPassword(VAULT_PASSWORD);
  await page.waitUntil("document.querySelector('#export') && document.querySelector('#import-file')", {
    timeout: 90000, label: 'the export and import screen',
  });
  await page.idle();
};

const exportVault = async () => {
  await page.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: DIR });
  const downloaded = new Promise((resolve) => {
    const done = (message) => {
      if (message.method !== 'Page.downloadProgress' || message.params.state !== 'completed') return;
      page.handlers = page.handlers.filter((h) => h !== done);
      resolve(true);
    };
    page.on(done);
  });
  await page.eval("document.querySelector('#export').click()");
  await within(downloaded, 60000);
  const saved = readdirSync(DIR).filter((n) => n.endsWith('.json'));
  check('the vault exports one file', saved.length === 1, saved.join(','));
  return join(DIR, saved[0]);
};

const toReview = async (path) => {
  const { result } = await page.send('Runtime.evaluate', { expression: "document.querySelector('#import-file')" });
  await page.send('DOM.setFileInputFiles', { files: [path], objectId: result.objectId });
  await page.send('Runtime.releaseObject', { objectId: result.objectId });
  await page.waitUntil("(() => { const n = document.querySelector('#import-password'); return n && n.offsetParent !== null; })()", {
    timeout: 30000, label: 'the password step',
  });
  await setValue('#import-password', VAULT_PASSWORD);
  await page.eval("[...document.querySelectorAll('#import-card button')].find(b => b.textContent.trim() === 'Open the file').click()");
  await page.waitUntil("(() => { const n = document.querySelector('#import-erase'); return n && n.offsetParent !== null; })()", {
    timeout: 90000, label: 'the ERASE field',
  });
};

// Replaces what the ERASE field holds with `text`, typed.
const typeOver = async (text) => {
  await page.call(() => { const f = document.querySelector('#import-erase'); f.focus(); f.select(); });
  await page.send('Input.insertText', { text });
  await page.frames();
};

// Adds `text` at the end of what the ERASE field holds, typed.
const typeOn = async (text) => {
  await page.call(() => {
    const f = document.querySelector('#import-erase');
    f.focus();
    f.setSelectionRange(f.value.length, f.value.length);
  });
  await page.send('Input.insertText', { text });
  await page.frames();
};

const press = async () => {
  await page.call((name) => {
    [...document.querySelectorAll('#import-card button')].find((b) => b.textContent.trim() === name).click();
  }, REPLACE);
  await page.idle();
  await page.frames();
};

// The field, the line its aria-describedby names, and the button, as
// they stand.
const state = () =>
  page.call((name) => {
    const field = document.querySelector('#import-erase');
    const card = document.querySelector('#import-card');
    const shown = (node) => node.getClientRects().length > 0 && getComputedStyle(node).visibility !== 'hidden';
    const ids = (field.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean);
    const lines = ids.map((id) => document.getElementById(id)).filter(Boolean);
    const line = lines.find((n) => card.contains(n)) || null;
    const button = [...card.querySelectorAll('button')].find((b) => b.textContent.trim() === name);
    const text = line && shown(line) ? line.innerText.trim() : '';
    // Every visible element in the card whose own text holds `words`.
    const holders = (words) => [...card.querySelectorAll('*')].filter(
      (n) => shown(n) && n.innerText && n.innerText.includes(words) && ![...n.children].some((c) => c.innerText && c.innerText.includes(words)),
    );
    let polite = false;
    for (let n = line; n && n !== document.body; n = n.parentElement) {
      if (n.getAttribute('aria-live') === 'polite' || n.getAttribute('role') === 'status') { polite = true; break; }
    }
    const fieldBox = field.getBoundingClientRect();
    const lineBox = line ? line.getBoundingClientRect() : null;
    return {
      value: field.value,
      invalid: field.getAttribute('aria-invalid') === 'true',
      described: ids,
      hasLine: Boolean(line),
      text,
      color: line ? getComputedStyle(line).color : '',
      icon: Boolean(line && (line.querySelector('svg, img') || getComputedStyle(line, '::before').content !== 'none'
        || getComputedStyle(line, '::before').backgroundImage !== 'none')),
      polite,
      underField: Boolean(lineBox && lineBox.top >= fieldBox.bottom - 0.5),
      holdersOfText: text ? holders(text).map((n) => (line.contains(n) || n === line ? 'line' : n.tagName + '.' + n.className)) : [],
      buttonTop: button ? Math.round(button.getBoundingClientRect().top + window.scrollY) : null,
    };
  }, REPLACE);

const rows = () => JSON.stringify(sql(`SELECT records.* FROM records ${OWN} ORDER BY record_id`));
const importsSent = () => watched[0].requests.filter((r) => r.url.includes('/api/import')).length;

await run(async () => {
  await vaultOwner();
  await holdings([['Franc account', 'CHF']]);
  await recording(new Date().toISOString().slice(0, 10), { 'Franc account': '10.00' });
  await unlockScreen();
  const file = await exportVault();
  await toReview(file);

  const before = rows();
  const sentBefore = importsSent();

  // -- Before anything is pressed: the field names its line --------------------

  const rest = await state();
  check('message line: the ERASE field names a line in the card in aria-describedby', rest.hasLine, JSON.stringify(rest));
  check('message line: the ERASE field is not invalid before it is refused', !rest.invalid, JSON.stringify(rest));

  // -- Replace my vault with nothing typed ----------------------------------------

  await press();
  const refused = await state();
  check('export-import 22: Replace my vault without ERASE sends no import', importsSent() === sentBefore);
  check('export-import 22: Replace my vault without ERASE changes nothing', rows() === before);
  check('message line: the refused ERASE field carries aria-invalid="true"', refused.invalid, JSON.stringify(refused));
  check('message line: the refusal is on the line the field names', refused.hasLine && refused.text !== ''
    && refused.text !== rest.text, JSON.stringify({ rest, refused }));
  check('message line: the line sits under the ERASE field', refused.underField, JSON.stringify(refused));
  check('message line: the line is a polite live region', refused.polite, JSON.stringify(refused));
  check('message line: the refusal takes the critical icon', refused.icon, JSON.stringify(refused));
  check('message line: the refusal turns the line a different color from its hint',
    !rest.text || refused.color !== rest.color, JSON.stringify({ rest, refused }));
  check('message line: the refusal is shown once, on the field\'s line and nowhere else in the card',
    JSON.stringify(refused.holdersOfText) === '["line"]', JSON.stringify(refused.holdersOfText));
  check('message line: the refusal does not move Replace my vault', refused.buttonTop === rest.buttonTop,
    `${rest.buttonTop} -> ${refused.buttonTop}`);

  // -- Typing ERASE clears it, with no second press ------------------------------

  await typeOn('ERAS');
  check('export-import 22: ERAS is still not ERASE', (await state()).value === 'ERAS');
  await typeOn('E');
  const typed = await state();
  check('message line: typing ERASE drops aria-invalid at once', !typed.invalid, JSON.stringify(typed));
  check('message line: typing ERASE returns the line to its hint at once', typed.text === rest.text,
    JSON.stringify({ rest, typed }));
  check('message line: once ERASE is typed the refusal shows nowhere in the card',
    !(await page.call((words) => document.querySelector('#import-card').innerText.includes(words), refused.text)),
    refused.text);
  check('message line: clearing the refusal does not move Replace my vault', typed.buttonTop === rest.buttonTop,
    `${rest.buttonTop} -> ${typed.buttonTop}`);
  check('export-import 22: typing ERASE sends nothing on its own', importsSent() === sentBefore && rows() === before);

  // -- A word that is not ERASE is refused again ---------------------------------

  await typeOver('erase');
  await press();
  const lower = await state();
  check('export-import 22: "erase" in place of ERASE sends no import', importsSent() === sentBefore);
  check('export-import 22: "erase" in place of ERASE changes nothing', rows() === before);
  check('message line: "erase" is refused on the field\'s line with aria-invalid',
    lower.invalid && lower.text === refused.text, JSON.stringify(lower));
  check('message line: the refusal of "erase" is shown once, on the field\'s line',
    JSON.stringify(lower.holdersOfText) === '["line"]', JSON.stringify(lower.holdersOfText));
  await typeOver('ERASE');
  const retyped = await state();
  check('message line: retyping ERASE over a refused word clears the refusal at once',
    !retyped.invalid && retyped.text === rest.text, JSON.stringify(retyped));

  rmSync(DIR, { recursive: true, force: true });
});
