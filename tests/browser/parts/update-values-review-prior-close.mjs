// Reviewer's check of a proposal for a day with nothing published
// (spec/features/rate-lookup.md, Edge cases, Weekend, holiday or a day
// not yet published, criterion 6; record-snapshot.md, Update values),
// written from the spec alone. The proxy answers gold for the day before
// the recording date, and the dollar for the date itself.
import { check, run } from '../harness.mjs';
import { startRecorder } from '../recorder.mjs';

await run(async () => {
  const r = await startRecorder();
  await r.register();
  await r.seed();
  const { rec, ago, proposalsFor, format, newRecording, line, lineState, quiet } = r;

  const D = ago(15);
  const earlier = proposalsFor(D)['XAU-ozt'].asOf;
  await newRecording(D);
  await rec.waitUntil((query) => document.querySelector(query).querySelector('input').value !== '', { args: [line('XAU-ozt')], label: 'the proposals on arrival' });
  await quiet();
  const gold = await lineState('XAU-ozt');
  const usd = await lineState('USD');

  check(
    'review rate 6: a proposal for an earlier day names that day, never the recording date',
    earlier !== D && gold.chip === `Market rate as of ${await format('dayMonth', earlier, 'short')}` &&
      !gold.chip.includes(await format('dayMonth', D, 'short')),
    JSON.stringify({ chip: gold.chip, earlier, D }),
  );
  check('review rate 6: a proposal for the recording date itself names no day', usd.chip === 'Market rate', usd.chip);
}, { signsIn: false });
