// Reviewer's checks of the Account form's note box (spec/features/
// manage-accounts.md, Account form, Fields, Note, criteria 17 and 65;
// spec/design-system.md, Accessibility and Components, Disclosure),
// written from the spec alone. The name is read from the browser's
// accessibility tree, which is what a screen reader hears.
import { check, run } from '../harness.mjs';
import { startRecorder } from '../recorder.mjs';

const NOTE = '<img src=x onerror=alert(1)> joint with M';

await run(async () => {
  const r = await startRecorder();
  await r.register();
  const { rec, press, quiet, go, home, plantHere, reread } = r;
  await rec.send('Accessibility.enable');

  const [noted] = await plantHere([
    { type: 'account', payload: { name: 'Shared savings', unit: 'CHF', dims: {}, note: NOTE, archivedAt: null, createdAt: '2020-01-01T00:00:00Z' } },
  ]);
  await reread();
  await home();

  // The open form's multi-line text box, its accessible name, and the
  // visible label that names it by the box's id.
  const noteBox = async () => {
    const { result } = await rec.send('Runtime.evaluate', {
      expression: "[...document.querySelectorAll('textarea, [role=textbox][aria-multiline=true]')].find((e) => e.checkVisibility()) ?? null",
    });
    if (!result.objectId) return null;
    const { nodes } = await rec.send('Accessibility.getPartialAXTree', { objectId: result.objectId, fetchRelatives: false });
    const { result: dom } = await rec.send('Runtime.callFunctionOn', {
      objectId: result.objectId,
      functionDeclaration: function () {
        const label = this.id ? document.querySelector(`label[for="${CSS.escape(this.id)}"]`) : null;
        return {
          id: this.id,
          idCount: this.id ? document.querySelectorAll(`#${CSS.escape(this.id)}`).length : 0,
          label: label && label.checkVisibility() ? label.textContent.trim() : null,
          ariaLabel: this.getAttribute('aria-label'),
          value: this.value,
        };
      }.toString(),
      returnByValue: true,
    });
    return { ...dom.value, ignored: nodes[0].ignored, name: (nodes[0].name?.value ?? '').trim() };
  };
  // The visible "Add a note" control as a screen reader meets it: its
  // role and whether it says it is open.
  const disclosure = async () => {
    const { result } = await rec.send('Runtime.evaluate', {
      expression: "[...document.querySelectorAll('button, summary')].find((e) => e.textContent.trim() === 'Add a note' && e.checkVisibility()) ?? null",
    });
    if (!result.objectId) return null;
    const { nodes } = await rec.send('Accessibility.getPartialAXTree', { objectId: result.objectId, fetchRelatives: false });
    const expanded = nodes[0].properties?.find((p) => p.name === 'expanded')?.value.value;
    return { role: nodes[0].role?.value, name: nodes[0].name?.value, expanded };
  };
  const openNote = async () => {
    await rec.call(() => [...document.querySelectorAll('button, summary')].find((e) => e.textContent.trim() === 'Add a note').click());
    await quiet();
  };
  const named = (box) => box && !box.ignored && box.name === 'Note' && box.label === 'Note' && box.idCount === 1 && !box.ariaLabel;

  // Adding a holding: the note is collapsed behind the disclosure.
  await press('Add a holding');
  await rec.waitUntil("[...document.querySelectorAll('button, summary')].some((b) => b.textContent.trim() === 'Add a note')", { label: 'Add a note' });
  check('review: before Add a note opens, no note box is shown', (await noteBox()) === null);
  const closed = await disclosure();
  check('review: Add a note is announced as a control that says it is closed', closed?.name === 'Add a note' && closed.expanded === false, JSON.stringify(closed));
  await openNote();
  const opened = await disclosure();
  check('review: once pressed, Add a note says it is open', opened?.expanded === true, JSON.stringify(opened));
  const added = await noteBox();
  check(
    'review 65: once Add a note is open in a new holding, the note box is announced by its visible label, Note, which names it by its id',
    named(added),
    JSON.stringify(added),
  );
  await press('Cancel', '.dialog');

  // Editing a holding that has a note.
  await go(`#/holding/${noted}`);
  await rec.waitUntil("[...document.querySelectorAll('button, a')].some((b) => b.textContent.trim() === 'Edit')", { label: 'the Edit control' });
  await press('Edit');
  await quiet();
  if ((await noteBox()) === null) await openNote();
  const edited = await noteBox();
  check(
    'review 65: in the edit form, the note box is announced by its visible label, Note',
    named(edited),
    JSON.stringify(edited),
  );
  check(
    'review 17: the note box holds the decrypted note as literal text, and no element is made from it',
    edited?.value === NOTE && (await rec.call(() => document.querySelectorAll('img[src=x]').length)) === 0,
    JSON.stringify(edited?.value),
  );
}, { signsIn: false });
