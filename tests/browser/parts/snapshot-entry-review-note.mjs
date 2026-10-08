// Reviewer's checks of the value form's note box (spec/features/
// record-snapshot.md, Snapshot entry, Note, criterion 107;
// spec/design-system.md, Accessibility), written from the spec alone.
// The name is read from the browser's accessibility tree, which is what
// a screen reader hears.
import { check, run } from '../harness.mjs';
import { startRecorder } from '../recorder.mjs';

const NOTE = '<img src=x onerror=alert(1)> bonus paid in';

await run(async () => {
  const r = await startRecorder();
  await r.register();
  await r.seed();
  const { rec, D1, ago, id, quiet, press, go, format, plantHere, reread, snap } = r;
  await rec.send('Accessibility.enable');

  const NOTED = ago(30);
  await plantHere([{ ...snap('Savings', NOTED, '5100'), payload: { ...snap('Savings', NOTED, '5100').payload, note: NOTE } }]);
  await reread();

  const inForm = "[...document.querySelectorAll('.dialog')].find((d) => d.querySelector('#snapshot-value'))";
  // The value form's visible multi-line text box, its accessible name,
  // and the visible label that names it by the box's id.
  const noteBox = async () => {
    const { result } = await rec.send('Runtime.evaluate', {
      expression: `[...(${inForm}?.querySelectorAll('textarea, [role=textbox][aria-multiline=true]') ?? [])].find((e) => e.checkVisibility()) ?? null`,
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
          labelledBy: this.getAttribute('aria-labelledby'),
          value: this.value,
        };
      }.toString(),
      returnByValue: true,
    });
    return { ...dom.value, ignored: nodes[0].ignored, name: (nodes[0].name?.value ?? '').trim() };
  };
  const addNote = `[...(${inForm}?.querySelectorAll('button, summary') ?? [])].find((e) => e.textContent.trim() === 'Add a note' && e.checkVisibility())`;
  const openNote = async () => {
    await rec.waitUntil(`Boolean(${addNote})`, { label: 'Add a note' });
    await rec.send('Runtime.evaluate', { expression: `${addNote}.click()` });
    await quiet();
  };
  const named = (box) => box !== null && !box.ignored && box.name === 'Note' && box.label === 'Note' && box.idCount === 1 && !box.ariaLabel && !box.labelledBy;
  const closeForm = async () => {
    await rec.key('Escape');
    await quiet();
  };
  const editEntry = async (name, iso) => {
    await go(`#/holding/${id[name]}`);
    const label = await format('longDate', iso);
    await rec.call((day) => [...document.querySelectorAll('.card .data-table tbody tr')].find((row) => row.cells[0].textContent.startsWith(day))
      .querySelectorAll('button').forEach((b) => { if (b.textContent === 'Edit') b.click(); }), label);
    await rec.waitUntil("document.querySelector('#snapshot-value')", { label: `the entry at ${iso}` });
    await quiet();
  };

  // A new figure from the holding's page: the note waits behind Add a note.
  await go(`#/holding/${id.Brokerage}`);
  await press('Record a value', '.form-actions');
  await rec.waitUntil("document.querySelector('#snapshot-value')", { label: 'the value form' });
  await quiet();
  check('review: before Add a note opens, the value form shows no note box', (await noteBox()) === null);
  await openNote();
  const fresh = await noteBox();
  check(
    'review 107: once Add a note is open on a new figure, the note box is announced by its visible label, Note, which names it by its id',
    named(fresh),
    JSON.stringify(fresh),
  );
  await closeForm();

  // Editing a stored figure without a note.
  await editEntry('Brokerage', D1);
  if ((await noteBox()) === null) await openNote();
  const plain = await noteBox();
  check(
    'review 107: editing a stored figure, once Add a note is open the note box is announced by its visible label, Note',
    named(plain),
    JSON.stringify(plain),
  );
  await closeForm();

  // Editing a stored figure that carries a note.
  await editEntry('Savings', NOTED);
  if ((await noteBox()) === null) await openNote();
  const noted = await noteBox();
  check(
    'review 107: editing a figure that has a note, the note box is announced by its visible label, Note',
    named(noted),
    JSON.stringify(noted),
  );
  check(
    'review: the note box holds the decrypted note as literal text, and no element is made from it',
    noted?.value === NOTE && (await rec.call(() => document.querySelectorAll('img[src=x]').length)) === 0,
    JSON.stringify(noted?.value),
  );
}, { signsIn: false });
