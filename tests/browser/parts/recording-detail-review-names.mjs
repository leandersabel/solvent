// Reviewer's checks of the names and counts in Recording detail's delete
// confirmation and its partial delete (spec/features/record-snapshot.md,
// Recording detail, Delete and States, criteria 45 and 104) against design-system.md, Typography,
// Figures: a count agrees with its noun and a verb with its count, and
// names in a sentence read "A, B and C". Written from the spec alone.
import { check, click, failing, inDialog, page, plant, reloadModel, run, vaultOwner } from '../harness.mjs';
import { disagreeing } from '../counts.mjs';
import { chains, lists } from '../names.mjs';

const DAY = 86400000;
const ago = (days) => new Date(Date.now() - days * DAY).toISOString().slice(0, 10);
const GOLD = 'Gold, troy ounce';
const SILVER = 'Silver, troy ounce';
// The sentence naming the units: its count, the units, and its verb.
const MOVES = /(\d+) (holdings?) measured in (.+?) (moves?) on that date/;

const account = (name, unit, archivedAt = null) => ({
  type: 'account',
  payload: { name, unit, dims: {}, note: null, archivedAt, createdAt: '2000-01-01T00:00:00Z' },
});
const snapshot = (accountId, date, value) => ({ type: 'snapshot', accountId, payload: { date, value, note: null } });
const price = (symbol, date, rate) => ({
  type: 'rate',
  payload: { symbol, date, rate, rateTarget: 'CHF', rateSource: 'manual', rateAsOf: null, proposedRate: null },
});

// Deleting at `date` while every DELETE of `kept` fails, and the
// screen's text once it has reloaded to what is left.
const deleteKeeping = async (date, kept) => {
  await page.call((day) => { location.hash = `#/recording/${day}`; }, date);
  await click('Delete');
  await page.waitUntil("document.querySelector('.dialog')", { label: 'the delete confirmation' });
  await failing((request) => request.method === 'DELETE' && kept.some((id) => request.url.endsWith(id)), async () => {
    await inDialog('Delete the recording');
    await page.waitUntil("!document.querySelector('.dialog') && document.querySelector('main').innerText.includes('Delete again')", {
      timeout: 60000, label: 'the delete that landed in part',
    });
  });
  return page.eval("document.querySelector('main').innerText");
};

// The delete confirmation's text for the recording at `date`.
const confirmationAt = async (date) => {
  await page.call((day) => { location.hash = `#/recording/${day}`; }, date);
  await click('Delete');
  await page.waitUntil("document.querySelector('.dialog') && document.querySelector('.dialog').innerText.includes('Delete the recording for')", {
    label: `the delete confirmation for ${date}`,
  });
  const said = await page.eval("document.querySelector('.dialog').innerText");
  await page.key('Escape');
  await page.waitUntil("!document.querySelector('.dialog')", { label: 'the confirmation to close' });
  await page.call(() => { location.hash = '#/'; });
  return said;
};

// The count, units and verb agree, and the units read as `units` say.
const verdict = (label, said, count, units) => {
  const sentence = said.match(MOVES);
  check(`review 45: ${label}: the confirmation says how many holdings move`, Boolean(sentence), said);
  if (!sentence) return;
  const [, n, noun, named, verb] = sentence;
  check(
    `review 45: ${label}: "${count} ${count === 1 ? 'holding' : 'holdings'}" and its verb agree with the count`,
    Number(n) === count && noun === (count === 1 ? 'holding' : 'holdings') && verb === (count === 1 ? 'moves' : 'move') &&
      disagreeing(said).length === 0,
    sentence[0],
  );
  check(
    `review 104: ${label}: the units read "${units.length > 2 ? 'A, B and C' : units.join(' and ')}", never chained with "and"`,
    lists(named, units) && named.split(' and ').length === Math.min(units.length, 2) && !chains(said, units),
    named,
  );
};

await run(async () => {
  await vaultOwner();
  const FOUR = ago(60);
  const TWO = ago(70);
  const ONE = ago(80);
  const UNHELD = ago(90);
  const THREE_ZEROS = ago(100);
  const TWO_ZEROS = ago(110);
  const EARLIER = ago(130);

  const [cantonal, dollar, otherDollar, gold, silver, flat, ...archived] = await plant([
    account('Cantonal account', 'CHF'),
    account('Dollar account', 'USD'),
    account('Second dollar account', 'USD'),
    account('Gold bars', 'XAU-ozt'),
    account('Silver coins', 'XAG-ozt'),
    account('Flat', 'm2'),
    account('Savings A', 'CHF', THREE_ZEROS),
    account('Savings B', 'CHF', THREE_ZEROS),
    account('Savings C', 'CHF', THREE_ZEROS),
    account('Pension D', 'CHF', TWO_ZEROS),
    account('Pension E', 'CHF', TWO_ZEROS),
  ]);
  await plant([
    // Every holding has a figure before any date deleted here.
    ...[cantonal, dollar, otherDollar, gold, silver, flat, ...archived].map((id) => snapshot(id, EARLIER, '10')),
    ...[cantonal, dollar, gold, silver, flat].map((id) => snapshot(id, FOUR, '20')),
    ...['USD', 'XAU-ozt', 'XAG-ozt', 'm2'].map((symbol) => price(symbol, FOUR, '2')),
    snapshot(cantonal, TWO, '30'),
    price('XAU-ozt', TWO, '2600'),
    price('m2', TWO, '9000'),
    snapshot(cantonal, ONE, '40'),
    price('XAG-ozt', ONE, '25'),
    // A price for a unit no holding is measured in, beside one that is:
    // one holding moves, whatever else the sentence names.
    snapshot(cantonal, UNHELD, '50'),
    price('XAG-ozt', UNHELD, '26'),
    price('EUR', UNHELD, '0.95'),
    // Archives' zeros and a price: Delete is offered and names them.
    ...archived.slice(0, 3).map((id) => snapshot(id, THREE_ZEROS, '0')),
    price('USD', THREE_ZEROS, '0.9'),
    ...archived.slice(3).map((id) => snapshot(id, TWO_ZEROS, '0')),
    price('USD', TWO_ZEROS, '0.91'),
  ]);
  const PART = ago(65);
  const partial = await plant([
    ...[cantonal, dollar, gold].map((id) => snapshot(id, PART, '25')),
    price('XAG-ozt', PART, '24'),
    price('m2', PART, '9500'),
  ]);
  await reloadModel();

  verdict('four units', await confirmationAt(FOUR), 5, ['USD', GOLD, SILVER, 'm2']);
  verdict('two units', await confirmationAt(TWO), 2, [GOLD, 'm2']);
  verdict('one unit and one holding', await confirmationAt(ONE), 1, [SILVER]);

  // The reported case: one holding, and two units named.
  const unheld = await confirmationAt(UNHELD);
  const sentence = unheld.match(MOVES);
  check(
    'review 45: one holding among two priced units reads "1 holding ... moves", never "move"',
    Boolean(sentence) && sentence[1] === '1' && sentence[2] === 'holding' && sentence[4] === 'moves' && disagreeing(unheld).length === 0,
    sentence ? sentence[0] : unheld,
  );
  check(
    'review 104: the units of one holding among two priced units are never chained with "and"',
    Boolean(sentence) && sentence[3].split(' and ').length <= 2,
    sentence ? sentence[3] : unheld,
  );

  const three = await confirmationAt(THREE_ZEROS);
  check(
    'review 104: three archives\' zeros at a date are named "A, B and C", never chained with "and"',
    lists(three, ['Savings A', 'Savings B', 'Savings C']) && !chains(three, ['Savings A', 'Savings B', 'Savings C']),
    three,
  );
  const two = await confirmationAt(TWO_ZEROS);
  check(
    'review 104: two archives\' zeros at a date are named "A and B"',
    lists(two, ['Pension D', 'Pension E']),
    two,
  );
  check('review 45: the confirmations at dates holding archives\' zeros keep their counts in agreement',
    disagreeing(three).length === 0 && disagreeing(two).length === 0, `${three} | ${two}`);

  // A delete that lands in part names what is left.
  const [, keptDollar, keptGold, keptSilver] = partial;
  const left = await deleteKeeping(PART, [keptDollar, keptGold, keptSilver]);
  const leftNames = ['Dollar account', 'Gold bars', `the ${SILVER} price`];
  check(
    'review: a delete that lands in part names what is left "A, B and C"',
    left.includes('Part of the recording is still there: ') && lists(left, leftNames) && !chains(left, leftNames),
    left.slice(0, 800),
  );
}, { signsIn: false });
