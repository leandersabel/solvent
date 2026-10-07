// Reviewer's part for issue #439, written from spec/features/account-settings.md
// (Dimensions, Editing a label; criterion 75) and spec/design-system.md
// (Components, Input: the message line) blind to the change. A blank
// rename of a dimension or of a value is refused with its error on the
// field's own message line, and the error returns to the hint the moment
// a name is typed: the line loses the error copy and its critical ink,
// and the field loses `aria-invalid`, before anything is saved. The error
// stays while what is typed is still blank, comes back on the next blank
// commit, and is gone when a cancelled rename is opened again.
//
// Text goes in as real typing, through the browser's own input pipeline,
// so the check holds whichever event the screen listens to.
import { check, holdings, page, recording, run, setProfile, unlockDashboard, vaultOwner, watched } from '../harness.mjs';

const BLANK = 'A name cannot be blank.';
const LIQUIDITY = {
  id: 'liq00001',
  label: 'Liquidity',
  archivedAt: null,
  values: [{ id: 'cash0001', label: 'Cash', archivedAt: null }, { id: 'inv00001', label: 'Investments', archivedAt: null }],
};

const puts = () => watched[0].requests.filter((r) => r.method === 'PUT').length;

// Opens the rename of the label `label` with its Edit action, and keeps
// the field it reveals, the visible text field holding that label, as
// `window.__field`.
const openRename = async (label) => {
  await page.call((name) => {
    const seen = (n) => n.checkVisibility();
    const leaf = [...document.querySelectorAll('#app *')].find((n) => seen(n) && n.children.length === 0 && n.textContent.trim() === name);
    let box = leaf;
    while (box && ![...box.querySelectorAll('button')].some((b) => seen(b) && b.textContent.trim() === 'Edit')) box = box.parentElement;
    [...box.querySelectorAll('button')].find((b) => seen(b) && b.textContent.trim() === 'Edit').click();
  }, label);
  await page.waitUntil(
    (name) => [...document.querySelectorAll('#app input')].some((i) => i.checkVisibility() && i.value === name),
    { args: [label], label: `the rename field of ${label}` },
  );
  await page.call((name) => {
    window.__field = [...document.querySelectorAll('#app input')].find((i) => i.checkVisibility() && i.value === name);
  }, label);
};

// Replaces what the field holds with `text`, typed.
const typeOver = async (text) => {
  await page.call(() => { window.__field.focus(); window.__field.select(); });
  await page.send('Input.insertText', { text });
  await page.frames();
};
// Adds `text` at the end of what the field holds, typed.
const typeOn = async (text) => {
  await page.call(() => { const f = window.__field; f.focus(); f.setSelectionRange(f.value.length, f.value.length); });
  await page.send('Input.insertText', { text });
  await page.frames();
};

// The visible button named `name` nearest the open field.
const press = (name) =>
  page.call((words) => {
    let box = window.__field;
    const find = () => [...box.querySelectorAll('button')].find((b) => b.checkVisibility() && b.textContent.trim() === words);
    while (box && !find()) box = box.parentElement;
    find().click();
  }, name);

// The open field and the message line it names in aria-describedby.
const fieldState = () =>
  page.call((copy) => {
    const probe = document.createElement('div');
    probe.style.color = 'var(--status-critical)';
    document.body.append(probe);
    const critical = getComputedStyle(probe).color;
    probe.remove();
    const f = window.__field;
    const lines = (f.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean).map((id) => document.getElementById(id)).filter(Boolean);
    const errorLine = lines.find((l) => l.textContent.includes(copy));
    return {
      connected: f.isConnected,
      open: f.isConnected && f.checkVisibility(),
      value: f.value,
      invalid: f.getAttribute('aria-invalid') === 'true',
      onLine: Boolean(errorLine),
      critical: lines.some((l) => l.textContent.trim() !== '' && getComputedStyle(l).color === critical),
      shown: document.body.innerText.includes(copy),
    };
  }, BLANK);

// The refusal is on screen, the field open with what was typed.
const refused = (s) => s.open && s.shown;
// The message line is the field's own: named in aria-describedby, in
// critical ink, and the field marked invalid while it is an error.
const wired = (s) => s.invalid && s.onLine && s.critical;
const cleared = (s) => s.open && !s.invalid && !s.shown && !s.critical;

// The top edge of what sits below the open field and outside its message
// line: the nearest visible text under it. The message line holds its
// place, so an error that comes or goes moves none of it
// (spec/design-system.md, Components, Input).
const belowTop = () =>
  page.call(() => {
    const f = window.__field;
    const bottom = f.getBoundingClientRect().bottom;
    const lines = (f.getAttribute('aria-describedby') || '').split(/\s+/).map((id) => document.getElementById(id)).filter(Boolean);
    const tops = [...document.querySelectorAll('#app *')]
      .filter((n) => n.children.length === 0 && n.checkVisibility() && n.textContent.trim() && !lines.some((l) => l.contains(n)))
      .map((n) => n.getBoundingClientRect().top).filter((top) => top >= bottom);
    return Math.round(Math.min(...tops));
  });

const renameCase = async (what, label, commit) => {
  await openRename(label);
  const before = puts();
  const still = await belowTop();
  await typeOver('   ');
  await commit();
  await page.idle();
  const blank = await fieldState();
  const shifted = await belowTop();
  check(`design-system Input: the ${what} rename's error moves nothing below the field`, shifted === still, `${still} -> ${shifted}`);
  check(`review 75: a blank ${what} rename committed with ${commit.name} is refused and keeps what was typed`,
    refused(blank) && blank.value === '   ' && puts() === before, JSON.stringify(blank));
  check(`design-system Input: the blank ${what} rename's error is on the message line the field names, and the field is invalid`,
    wired(blank), JSON.stringify(blank));

  await typeOn(' ');
  const stillBlank = await fieldState();
  check(`review 75: the ${what} rename's error stays while what is typed is still blank`, refused(stillBlank), JSON.stringify(stillBlank));

  await typeOver('N');
  const typed = await fieldState();
  const back = await belowTop();
  check(`design-system Input: the ${what} rename's error clearing moves nothing below the field`, back === still, `${still} -> ${back}`);
  check(`review 75: the ${what} rename's error clears the moment a name is typed, before any save`,
    cleared(typed) && typed.value === 'N' && puts() === before, JSON.stringify(typed));

  await typeOn('ew name');
  const longer = await fieldState();
  check(`review 75: the ${what} rename's error stays cleared as typing goes on`, cleared(longer) && longer.value === 'New name', JSON.stringify(longer));

  await typeOver(' ');
  await commit();
  await page.idle();
  const again = await fieldState();
  check(`review 75: a second blank commit of the ${what} rename is refused again`, refused(again) && puts() === before, JSON.stringify(again));

  await press('Cancel');
  await page.idle();
  await openRename(label);
  const reopened = await fieldState();
  check(`review 75: a cancelled ${what} rename opens again holding the stored label and no error`,
    cleared(reopened) && reopened.value === label && puts() === before, JSON.stringify(reopened));
  await press('Cancel');
  await page.idle();
};

const save = () => press('Save');
const enter = () => page.key('Enter');

await run(async () => {
  await vaultOwner();
  await holdings([['Lone account', 'CHF']]);
  await recording(new Date().toISOString().slice(0, 10), { 'Lone account': '100.00' });
  await setProfile({ dimensions: [LIQUIDITY] });
  await unlockDashboard('the dashboard');
  await page.eval(`document.querySelector('.topbar nav a[href="#/settings"]').click()`);
  await page.waitUntil("document.querySelector('.link-row[href=\"/settings/dimensions\"]')", { label: 'settings' });
  await page.eval(`document.querySelector('.link-row[href="/settings/dimensions"]').click()`);
  await page.waitUntil("document.body.innerText.includes('Liquidity') && document.body.innerText.includes('assigned')", {
    timeout: 20000, label: 'the dimensions screen',
  });
  await page.idle();

  await renameCase('dimension', 'Liquidity', save);
  await renameCase('value', 'Cash', save);
  await renameCase('dimension', 'Liquidity', enter);
  await renameCase('value', 'Investments', enter);

  // A refused rename, then a name typed and saved, writes once.
  await openRename('Cash');
  const before = puts();
  await typeOver(' ');
  await save();
  await page.idle();
  await typeOver('Cash at hand');
  await save();
  await page.idle();
  await page.waitUntil("document.body.innerText.includes('Cash at hand') && ![...document.querySelectorAll('#app input')].some(i => i.checkVisibility() && i.value === 'Cash at hand')", {
    label: 'the saved rename',
  });
  check('review 75: a name typed after a refusal saves in one write with no error left', puts() === before + 1
    && !(await page.eval(`document.body.innerText.includes(${JSON.stringify(BLANK)})`)), String(puts() - before));
});
