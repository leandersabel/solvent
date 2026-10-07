// Reviewer's part for issue #414, written from spec/features/admin-invites.md
// (Admin, Units, its States, criterion 60), blind to the change: a
// Retire or a Restore the server refuses, or that never reaches it,
// reads "Nothing was retired." or "Nothing was restored." on its own
// row and on no other, and the row stays as it was, in the page and in
// the database.
import { administrator, check, click, expectedFailures, intercept, page, run, sql } from '../harness.mjs';

const NOT_RETIRED = 'Nothing was retired.';
const NOT_RESTORED = 'Nothing was restored.';

const openUnits = async () => {
  await click('Invites');
  await click('Units');
  await page.waitUntil(
    () => [...document.querySelectorAll('td')].some((td) => td.textContent.trim() === 'XAU-ozt'),
    { timeout: 60000, label: 'the units table' },
  );
  await page.call(() => document.querySelectorAll('details').forEach((d) => { d.open = true; }));
};

// Each table row keyed by its code: its action, whether it carries the
// Retired chip, its text, and whether that text is drawn on screen.
const unitRows = () =>
  page.call(() => {
    const out = {};
    for (const tr of document.querySelectorAll('tr')) {
      const cells = tr.querySelectorAll('td');
      if (!cells.length) continue;
      const code = cells[0].textContent.replace('Retired', '').trim();
      const button = [...tr.querySelectorAll('button')].find((b) => ['Restore', 'Retire'].includes(b.textContent.trim()));
      const box = tr.getBoundingClientRect();
      out[code] = {
        action: button && button.textContent.trim(),
        chip: cells[0].textContent.includes('Retired'),
        text: tr.innerText,
        drawn: box.width > 0 && box.height > 0,
      };
    }
    return out;
  });

// Presses `action` on the row of `code` and confirms it in its dialog.
const press = async (code, action) => {
  await page.call((name, label) => {
    const tr = [...document.querySelectorAll('tr')].find((row) => row.querySelector('td')
      && row.querySelector('td').textContent.replace('Retired', '').trim() === name);
    [...tr.querySelectorAll('button')].find((b) => b.textContent.trim() === label).click();
  }, code, action);
  await page.waitUntil((label) => [...document.querySelectorAll('.dialog button')].some((b) => b.textContent.trim() === label), {
    args: [action],
    label: `the ${action} dialog for ${code}`,
  });
  await page.call((label) => [...document.querySelectorAll('.dialog button')].find((b) => b.textContent.trim() === label).click(), action);
};

const retiredIn = (code) => sql('SELECT retired FROM symbols WHERE symbol = ?', code)[0].retired;
const showsOn = (code, words) =>
  page.waitUntil(
    (name, text) => [...document.querySelectorAll('tr')].some((tr) => tr.querySelector('td')
      && tr.querySelector('td').textContent.replace('Retired', '').trim() === name && tr.innerText.includes(text)),
    { args: [code, words], label: `"${words}" on the ${code} row` },
  );

// Refuses every PATCH to a unit with `answer` while `body` runs.
const refusing = async (answer, body) => {
  expectedFailures.add('/api/admin/symbols/');
  const stop = await intercept(page, '*/api/admin/symbols/*', (request) => (request.method === 'PATCH' ? answer : null));
  try {
    await body();
  } finally {
    await stop();
    expectedFailures.delete('/api/admin/symbols/');
  }
};

const outcomes = [
  ['a 409', { status: 409, body: '{"error":"conflict"}' }],
  ['a 500', { status: 500, body: '{}' }],
  ['a dropped connection', { drop: true }],
];

await run(async () => {
  await administrator();
  sql("UPDATE symbols SET retired = 1 WHERE symbol = 'XAG-g'");

  for (const [how, answer] of outcomes) {
    await openUnits();
    await refusing(answer, async () => {
      await press('CHF', 'Retire');
      await showsOn('CHF', NOT_RETIRED);
    });
    const rows = await unitRows();
    check(`a Retire refused with ${how} reads "${NOT_RETIRED}" on its row, drawn on screen`, rows.CHF.text.includes(NOT_RETIRED) && rows.CHF.drawn, JSON.stringify(rows.CHF));
    check(`after it, CHF still offers Retire without the Retired chip`, rows.CHF.action === 'Retire' && !rows.CHF.chip, JSON.stringify(rows.CHF));
    check(`after it, CHF is still active in the database`, retiredIn('CHF') === 0);
    check(
      `after it, no other row reads either error`,
      Object.entries(rows).every(([code, row]) => code === 'CHF' || (!row.text.includes(NOT_RETIRED) && !row.text.includes(NOT_RESTORED))),
    );

    await openUnits();
    await refusing(answer, async () => {
      await press('XAG-g', 'Restore');
      await showsOn('XAG-g', NOT_RESTORED);
    });
    const after = await unitRows();
    const silver = after['XAG-g'];
    check(`a Restore refused with ${how} reads "${NOT_RESTORED}" on its row, drawn on screen`, silver.text.includes(NOT_RESTORED) && silver.drawn, JSON.stringify(silver));
    check(`after it, XAG-g stays retired: Restore and the Retired chip`, silver.action === 'Restore' && silver.chip, JSON.stringify(silver));
    check(`after it, XAG-g is still retired in the database`, retiredIn('XAG-g') === 1);
    check(
      `after it, no other row reads either error`,
      Object.entries(after).every(([code, row]) => code === 'XAG-g' || (!row.text.includes(NOT_RETIRED) && !row.text.includes(NOT_RESTORED))),
    );
  }

  // The rows really are where the screen left them: a reload agrees.
  await page.eval('location.reload()');
  await page.waitUntil("location.pathname === '/admin' && document.querySelector('#app .section-switcher')", {
    timeout: 90000,
    label: 'the admin area again',
  });
  await openUnits();
  const reloaded = await unitRows();
  check(
    'after a reload CHF is active and XAG-g retired',
    reloaded.CHF.action === 'Retire' && !reloaded.CHF.chip && reloaded['XAG-g'].action === 'Restore' && reloaded['XAG-g'].chip,
    JSON.stringify([reloaded.CHF, reloaded['XAG-g']]),
  );
}, { signsIn: false });
