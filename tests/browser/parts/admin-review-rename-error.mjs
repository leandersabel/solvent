// Reviewer's part for issue #439, written from spec/features/admin-invites.md
// (Admin, Units: Name changes by an inline rename) and spec/design-system.md
// (Components, Input) blind to the change. The rename is the same input
// revealed in place: clicking away writes nothing and leaves it open,
// Cancel shows the stored name again, and Save writes the name alone, once.
// Whatever error a blank Save leaves on the field, whether the browser or
// the server found it, returns to the hint the moment a name is typed.
//
// Text goes in as real typing, through the browser's own input pipeline.
import { administrator, check, click, expectedFailures, page, run, sql, watched } from '../harness.mjs';

const CODE = 'USD';
const patches = () => watched[0].requests.filter((r) => r.method === 'PATCH' && r.url.includes(`/api/admin/symbols/${CODE}`));
const stored = () => sql('SELECT label FROM symbols WHERE symbol = ?', CODE)[0].label;

const openUnits = async () => {
  await click('Units');
  await page.waitUntil(
    (code) => [...document.querySelectorAll('td')].some((td) => td.textContent.trim() === code),
    { args: [CODE], timeout: 60000, label: 'the units table' },
  );
  await page.idle();
};

// Clicks the visible Edit on the unit's row and keeps the field it
// reveals as `window.__field`.
const openRename = async () => {
  await page.call((code) => {
    const row = [...document.querySelectorAll('tr')].find((tr) => tr.querySelector('td')?.textContent.trim() === code);
    [...row.querySelectorAll('button')].find((b) => b.checkVisibility() && b.textContent.trim() === 'Edit').click();
  }, CODE);
  await page.waitUntil(
    (code) => [...document.querySelectorAll('tr')].find((tr) => tr.querySelector('td')?.textContent.trim() === code)
      ?.querySelector('input[type=text], input:not([type])')?.checkVisibility(),
    { args: [CODE], label: 'the unit rename field' },
  );
  await page.call((code) => {
    const row = [...document.querySelectorAll('tr')].find((tr) => tr.querySelector('td')?.textContent.trim() === code);
    window.__field = [...row.querySelectorAll('input')].find((i) => i.checkVisibility() && i.type === 'text');
  }, CODE);
};

const typeOver = async (text) => {
  await page.call(() => { window.__field.focus(); window.__field.select(); });
  await page.send('Input.insertText', { text });
  await page.frames();
};

const press = (name) =>
  page.call((words) => {
    let box = window.__field;
    const find = () => [...box.querySelectorAll('button')].find((b) => b.checkVisibility() && b.textContent.trim() === words);
    while (box && !find()) box = box.parentElement;
    find().click();
  }, name);

// The open field, and the lines of its row's visible text other than
// the ones `baseline` holds, which is where an error the row gained is
// read. Whether the field names a line in aria-describedby, and whether
// a line it names is in critical ink, is read apart.
const fieldState = (baseline = []) =>
  page.call((known) => {
    const probe = document.createElement('div');
    probe.style.color = 'var(--status-critical)';
    document.body.append(probe);
    const critical = getComputedStyle(probe).color;
    probe.remove();
    const f = window.__field;
    const lines = (f.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean).map((id) => document.getElementById(id)).filter(Boolean);
    const row = f.closest('tr');
    return {
      open: f.isConnected && f.checkVisibility(),
      value: f.value,
      invalid: f.getAttribute('aria-invalid') === 'true',
      onLine: lines.some((l) => l.textContent.trim() !== '' && getComputedStyle(l).color === critical),
      lines: row ? row.innerText.split('\n').map((l) => l.trim()).filter((l) => l && !known.includes(l)) : [],
    };
  }, baseline);
const rowLines = () => page.call(() => window.__field.closest('tr').innerText.split('\n').map((l) => l.trim()).filter(Boolean));

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

await run(async () => {
  await administrator();
  await openUnits();
  const name = stored();

  await openRename();
  await typeOver('Dollar');
  await page.call(() => { window.__field.blur(); document.body.click(); });
  await page.idle();
  const away = await fieldState();
  check('Units: clicking away from a rename writes nothing and leaves it open', patches().length === 0 && away.open && away.value === 'Dollar', JSON.stringify(away));

  await press('Cancel');
  await page.idle();
  check('Units: Cancel abandons the rename with the stored name shown', patches().length === 0 && stored() === name
    && (await page.call((label) => document.body.innerText.includes(label), name)), name);

  expectedFailures.add(`/api/admin/symbols/${CODE}`);
  await openRename();
  const baseline = await rowLines();
  const still = await belowTop();
  await typeOver('   ');
  await press('Save');
  await page.idle();
  const blank = await fieldState(baseline);
  const shifted = await belowTop();
  check('design-system Input: the unit rename\'s error moves nothing below the field', shifted === still, `${still} -> ${shifted}`);
  check('Units: a blank name is not stored', stored() === name, stored());
  check('Units: a blank Save says why on the row, the field open with what was typed',
    blank.open && blank.value === '   ' && blank.lines.length > 0, JSON.stringify(blank));
  check('design-system Input: the blank unit rename\'s error is on the message line the field names, and the field is invalid',
    blank.invalid && blank.onLine, JSON.stringify(blank));
  await typeOver('D');
  const typed = await fieldState(baseline);
  const back = await belowTop();
  check('design-system Input: the unit rename\'s error clearing moves nothing below the field', back === still, `${still} -> ${back}`);
  check('Units: the rename\'s error returns to the hint the moment a name is typed',
    typed.open && !typed.invalid && typed.lines.length === 0 && typed.value === 'D', JSON.stringify(typed));
  expectedFailures.delete(`/api/admin/symbols/${CODE}`);

  const sent = patches().length;
  await typeOver('Dollar');
  await press('Save');
  await page.idle();
  const saved = patches().slice(sent);
  check('Units: Save writes the name alone, once', saved.length === 1 && JSON.stringify(Object.keys(JSON.parse(saved[0].body))) === '["label"]'
    && stored() === 'Dollar', JSON.stringify(saved));
}, { signsIn: false });
