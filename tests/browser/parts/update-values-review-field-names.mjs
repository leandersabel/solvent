// Reviewer's checks of the name a screen reader gives each value field on
// Update values, written from spec/features/record-snapshot.md (Update
// values, Layout, a row; criterion 105) and architecture.md's rule that
// decrypted content reaches the page only as text, without reading how
// the sweep is built. The name is read from the browser's accessibility
// tree, which is what a screen reader hears.
import { check, run } from '../harness.mjs';
import { startRecorder } from '../recorder.mjs';

// Quotes and markup, so a name built into markup rather than set as text
// shows: as an element of its own, or as a name cut short.
const HOSTILE = 'Q"><img data-review-pwn src=x> & \'co\'';

await run(async () => {
  const r = await startRecorder();
  await r.register();
  await r.seed();
  const { rec, T, D1, ago, HOLDINGS, ev, go, plantHere, reread, archiveElsewhere, newRecording, sweepToday, typeRow, pressRow, line, viewport, home } = r;
  await plantHere([{
    type: 'account',
    payload: { name: HOSTILE, unit: 'CHF', dims: {}, note: null, archivedAt: null, createdAt: '2020-01-02T00:00:00Z' },
  }]);
  await reread();
  await rec.send('Accessibility.enable');

  // The accessibility tree's name of the field found by `find`, a function
  // of `i` run in the page, or null when there is no such field.
  const nameOf = async (find, i) => {
    const { result: global } = await rec.send('Runtime.evaluate', { expression: 'globalThis' });
    const { result } = await rec.send('Runtime.callFunctionOn', {
      objectId: global.objectId, functionDeclaration: find.toString(), arguments: [{ value: i }],
    });
    if (!result.objectId) return null;
    const { nodes } = await rec.send('Accessibility.getPartialAXTree', { objectId: result.objectId, fetchRelatives: false });
    return nodes[0].ignored ? { ignored: true } : { name: nodes[0].name?.value ?? '' };
  };
  // Each row's holding, as the row shows it, and its value field's name.
  const fields = async () => {
    const holdings = await rec.call(() => [...document.querySelectorAll('.sweep-row')].map((row) => ({
      holding: row.querySelector('.holding-name').textContent,
      field: Boolean(row.querySelector('input')),
    })));
    const out = [];
    for (const [i, row] of holdings.entries()) {
      if (!row.field) continue;
      out.push({ holding: row.holding, ...(await nameOf(function (n) { return document.querySelectorAll('.sweep-row')[n].querySelector('input'); }, i)) });
    }
    return out;
  };
  const wrong = (seen) => seen.filter((f) => f.ignored || f.name !== `${f.holding} value`);
  const expectAll = async (state, wanted) => {
    const seen = await fields();
    const missing = wanted.filter((name) => !seen.some((f) => f.holding === name));
    check(
      `review 105: on ${state}, a screen reader names every value field "<holding> value"`,
      seen.length > 0 && missing.length === 0 && wrong(seen).length === 0,
      JSON.stringify({ missing, wrong: wrong(seen) }),
    );
  };
  const ACTIVE = [...HOLDINGS.map(([name]) => name), HOSTILE];

  // Today, from the top bar: every holding, the never-valued one included.
  await home();
  await sweepToday();
  await expectAll("today's sweep", ACTIVE);
  check(
    'review architecture: a holding name with markup in it adds no element to the sweep',
    !(await ev("Boolean(document.querySelector('[data-review-pwn]'))")),
    '',
  );

  // A free date, picked as a new recording.
  await home();
  await newRecording(ago(57));
  await expectAll('a new recording at a free date', ACTIVE);

  // A reopened recording, an archived holding with a figure there included.
  await archiveElsewhere('Fund 3', T);
  await reread();
  await go(`#/sweep/${D1}`);
  const reopened = await fields();
  check(
    'review 105: on a reopened recording, an archived holding\'s value field is named by its holding',
    reopened.some((f) => f.holding === 'Fund 3' && f.name === 'Fund 3 value') && wrong(reopened).length === 0,
    JSON.stringify(reopened.filter((f) => f.holding === 'Fund 3' || wrong(reopened).includes(f))),
  );

  // A row redrawn by its own Record keeps the name.
  await typeRow('Mortgage', '-399000');
  await pressRow('Mortgage');
  const recorded = await fields();
  check(
    'review 105: a row recorded on the sweep still names its field "<holding> value"',
    recorded.some((f) => f.holding === 'Mortgage' && f.name === 'Mortgage value') && wrong(recorded).length === 0,
    JSON.stringify(recorded.filter((f) => f.holding === 'Mortgage' || wrong(recorded).includes(f))),
  );

  // The rate line keeps the name the spec sets beside the row's.
  const gold = await nameOf(function (query) { return document.querySelector(query + ' input'); }, line('XAU-ozt'));
  check('review 105: the gold rate line\'s field still reads "Gold, troy ounce rate"',
    gold && gold.name === 'Gold, troy ounce rate', JSON.stringify(gold));

  // At phone width the rows stack, and the names stay.
  await viewport(390);
  await go(`#/sweep/${D1}`);
  await expectAll('a reopened recording at phone width', ACTIVE);
}, { signsIn: false });
