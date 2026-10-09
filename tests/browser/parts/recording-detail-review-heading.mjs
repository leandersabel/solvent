// Reviewer's checks of Recording detail's heading
// (spec/features/record-snapshot.md, Recording detail, Layout, "The
// date is the heading", States, the recording is gone, and criterion
// 52) against account-settings.md, How it works, Dates and numbers: a
// heading is written by `fullDate`, the month in full, never by
// `longDate`'s abbreviated month. Written from the spec alone.
import { check, page, plant, reloadModel, run, setProfile, vaultOwner } from '../harness.mjs';

// September, because its short form differs from its full one in
// English ("Sep") and in German ("Sept.").
const DAY = '2025-09-20';

const account = (name) => ({
  type: 'account',
  payload: { name, unit: 'CHF', dims: {}, note: null, archivedAt: null, createdAt: '2000-01-01T00:00:00Z' },
});
const snapshot = (accountId, value) => ({ type: 'snapshot', accountId, payload: { date: DAY, value, note: null } });

// The day as `locale` writes it with the month in full, and abbreviated.
const written = (locale) => page.call((tag, iso) => {
  const at = new Date(`${iso}T00:00:00Z`);
  const as = (month) => new Intl.DateTimeFormat(tag, { day: 'numeric', month, year: 'numeric', timeZone: 'UTC' }).format(at);
  return JSON.stringify({ full: as('long'), short: as('short') });
}, locale, DAY).then(JSON.parse);

// Every heading shown on the screen outside a dialog, as its text.
const headings = () => page.call(() => JSON.stringify(
  [...document.querySelectorAll('main h1, main h2, main h3, main h4, main h5, main h6, main [role=heading]')]
    .filter((h) => !h.closest('.dialog') && h.getClientRects().length > 0)
    .map((h) => h.textContent.trim()),
)).then(JSON.parse);

const openAt = async (label, settled) => {
  await reloadModel(`#/recording/${DAY}`);
  await page.waitUntil(settled, { timeout: 30000, label });
  await page.frames();
};

// The date's heading reads the full form, alone, and no heading writes
// the abbreviated one.
const verdict = (label, seen, { full, short }) => {
  check(`review 52: ${label}: the date is a heading reading "${full}", with nothing beside it`, seen.includes(full), JSON.stringify(seen));
  check(
    `review 52: ${label}: no heading writes the date with its month abbreviated ("${short}")`,
    !seen.some((h) => h.includes(short)),
    JSON.stringify(seen),
  );
};

await run(async () => {
  await vaultOwner();
  const [savings] = await plant([account('Savings')]);
  const [figure] = await plant([snapshot(savings, '1000')]);
  const recorded = "document.querySelector('main') && document.querySelector('main').innerText.includes('Savings')";

  await setProfile({ locale: 'en-US' });
  const english = await written('en-US');
  check('review 52: the expected English heading spells September', english.full === 'September 20, 2025', english.full);
  await openAt('the recording in English', recorded);
  verdict('a recording, English', await headings(), english);

  await setProfile({ locale: 'de-CH' });
  const german = await written('de-CH');
  await openAt('the recording in German', recorded);
  verdict('a recording, Swiss German', await headings(), german);

  // Another window deletes the date: the screen says it holds no
  // recording, and a heading naming the date still writes it in full.
  await setProfile({ locale: 'en-US' });
  await page.call(async (id) => { await (await import('/static/js/api.js')).del(`/api/records/${id}`); }, figure);
  await openAt('the date that no longer holds a recording', "document.querySelector('main') && !document.querySelector('main').innerText.includes('Savings') && document.querySelector('main').innerText.trim().length > 0");
  const gone = await headings();
  check(
    'review 52: a date that no longer holds a recording renders no shell of it',
    !(await page.eval("document.querySelector('main').innerText")).includes('Savings'),
    JSON.stringify(gone),
  );
  check(
    `review 52: a date that no longer holds a recording heads it "${english.full}" where a heading names the date`,
    gone.filter((h) => h.includes('2025')).every((h) => h === english.full),
    JSON.stringify(gone),
  );
  check(
    `review 52: a date that no longer holds a recording writes no heading with the month abbreviated ("${english.short}")`,
    !gone.some((h) => h.includes(english.short)),
    JSON.stringify(gone),
  );
}, { signsIn: false });
