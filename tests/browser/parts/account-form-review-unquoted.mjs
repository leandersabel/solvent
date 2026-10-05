// Reviewer's check of the Account form's unit picker in a vault whose
// main currency no source quotes into (spec/features/manage-accounts.md,
// Account form, Fields, criterion 61), written from the spec alone. The
// currency is one an administrator added, stored with its flag on as an
// operator's shell would, so only the missing adapter says no source
// serves it.
import { check, run, sql } from '../harness.mjs';
import { startRecorder } from '../recorder.mjs';

const MAIN = 'ARS';

await run(async () => {
  sql("INSERT INTO symbols (symbol, label, kind, lookup) VALUES (?, 'Argentine Peso', 'currency', 1)", MAIN);
  const r = await startRecorder();
  await r.register();
  const { rec, model, plantHere, reread, go, press } = r;

  const options = async () => {
    await rec.waitUntil("document.querySelectorAll('#holding-unit-list [role=option]').length > 10", { label: 'the unit list' });
    return rec.call(() => [...document.querySelectorAll('#holding-unit-list [role=option]')].map((o) => o.textContent.trim()));
  };
  const units = (texts) => texts.filter((t) => !t.startsWith('Something else'));
  const marked = (t) => t.includes('rate entered by hand');

  await press('Add a holding');
  const before = units(await options());
  check(
    'review 61: in a vault totalling in CHF, a sourced currency is not marked rate entered by hand',
    before.some((t) => t.includes('(USD)') && !marked(t)),
    JSON.stringify(before),
  );
  await press('Cancel', '.dialog');

  const profile = await model(({ v }) => ({ recordId: v.profileRecord.recordId, version: v.profileRecord.version, payload: v.profile }));
  await plantHere([{
    type: 'profile', recordId: profile.recordId, version: profile.version + 1,
    payload: { ...profile.payload, mainCurrency: MAIN },
  }]);
  await reread();
  await go('#/');
  await press('Add a holding');
  const after = units(await options());
  const main = after.filter((t) => t.includes(`(${MAIN})`));
  check(
    'review 61: with no source quoting into the main currency, every unit option but it is marked rate entered by hand',
    main.length === 1 && !marked(main[0]) && after.filter((t) => !marked(t)).length === 1 &&
      after.some((t) => t.includes('(CHF)')) && after.some((t) => t.includes('(XAU-ozt)')),
    JSON.stringify(after),
  );
  check('review: the main currency heads the list', after[0] === main[0], JSON.stringify(after.slice(0, 3)));
}, { signsIn: false });
