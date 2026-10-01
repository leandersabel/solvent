// The registration form, for whichever kind the invite calls for
// (spec/ui/register.md).
//
// The invite decides which of two forms renders. Nothing on either
// form lets the person choose which kind of account they are making,
// and neither form mentions the other.
//
// The form is the same wherever it is drawn. A vault owner's is drawn
// by the vault page itself (app.js), so that what the derivation
// produces goes to the document that then shows the vault: the keys
// live in one document's memory and a page load would drop them. An
// administrator's has nothing to hand on and has a page of its own
// (page-register.js).
import * as api from './api.js';
import * as crypto from './crypto.js';
import { el } from './dom.js';
import { SCHEMA_VERSION } from './model.js';
import { WAIT_NOTE, passwordWithToggle } from './unlock.js';
import { MIN_LENGTH, strengthGauge } from './strength.js';

/** Builds the card.
 *
 *  `onCreated` is called once the server has made the account and
 *  started its session, with `{ kind, username }` and, for a vault
 *  owner, the keys this form made: `{ masterKey, dek, wrapper }`. They
 *  pass in memory to the caller and nowhere else. By then the password
 *  fields are empty and the invite token has been dropped. */
export function registerForm({ kind, token: inviteToken, currencies, kdf, onCreated }) {
  let token = inviteToken;
  const isVault = kind === 'vault_owner';

  const username = el('input', {
    type: 'text',
    autocomplete: 'username',
    autocapitalize: 'none',
    spellcheck: 'false',
    required: true,
  });
  username.addEventListener('input', () => {
    // Lowercased in the field as it is typed rather than quietly
    // changed on submit, so what they see is what they sign in with.
    const at = username.selectionStart;
    username.value = username.value.toLowerCase();
    username.setSelectionRange(at, at);
  });

  const password = el('input', { type: 'password', autocomplete: 'new-password', required: true });
  const confirm = el('input', { type: 'password', autocomplete: 'new-password', required: true });
  const currency = el('select', {}, currencies.map((row) =>
    el('option', { value: row.symbol, text: `${row.label} (${row.symbol})` }),
  ));
  const acknowledge = el('input', { type: 'checkbox' });
  const error = el('p', { class: 'field-error', hidden: true });
  const note = el('p', { class: 'hint', hidden: true, text: WAIT_NOTE });
  const submit = el('button', {
    type: 'submit',
    class: 'btn-primary',
    text: isVault ? 'Create vault' : 'Create account',
    disabled: true,
  });

  let strongEnough = false;
  const gauge = strengthGauge(password, (ok) => {
    strongEnough = ok;
    refresh();
  });
  function refresh() {
    submit.disabled = !strongEnough || (isVault && !acknowledge.checked);
  }
  acknowledge.addEventListener('change', refresh);

  const form = el('form', { class: 'card card-narrow', novalidate: true }, [
    el('h1', { class: 'card-heading', text: isVault ? 'Create your vault' : 'Create an administrator account' }),
    isVault
      ? null
      : el('p', {
          class: 'hint',
          text: 'This link creates an administrator account. It invites and removes people on this instance. It holds no financial data of its own and cannot read anybody else’s. If you also want to keep your own finances in Solvent, that is a separate account and you need a separate invite for it.',
        }),
    el('div', { class: 'field' }, [
      el('label', { text: 'Username' }),
      username,
      el('p', { class: 'hint', text: '3 to 32 characters: letters, digits, dots, dashes and underscores.' }),
    ]),
    el('div', { class: 'field' }, [el('label', { text: 'Password' }), passwordWithToggle(password)]),
    gauge.element,
    el('div', { class: 'field' }, [el('label', { text: 'Confirm password' }), passwordWithToggle(confirm)]),
    isVault
      ? el('div', { class: 'field' }, [
          el('label', { text: 'Main currency' }),
          currency,
          el('p', { class: 'hint', text: 'This cannot be changed later.' }),
        ])
      : null,
    isVault
      ? el('label', { class: 'checkbox callout callout-critical' }, [
          acknowledge,
          el('span', {
            text: 'I understand that if I lose this password, my data is permanently unreadable. Solvent has no way to reset it or recover my vault.',
          }),
        ])
      : null,
    error,
    submit,
    note,
  ]);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    error.hidden = true;
    if (password.value !== confirm.value) {
      fail('The two passwords do not match.');
      return;
    }
    if (password.value.length < MIN_LENGTH) {
      fail(`Use at least ${MIN_LENGTH} characters.`);
      return;
    }

    submit.disabled = true;
    submit.textContent = isVault ? 'Setting up your vault' : 'Creating your account';
    note.hidden = false;

    let created;
    try {
      const salt = crypto.b64encode(crypto.randomBytes(16));
      const keys = await crypto.deriveKeys(password.value, salt, kdf);
      const body = {
        inviteToken: token,
        username: username.value.trim(),
        authKey: keys.authKey,
        salt,
        kdf,
      };
      let dek = null;
      let wrapper = null;

      if (isVault) {
        dek = await crypto.generateDek();
        wrapper = await crypto.wrapDek(dek, keys.masterKey);
        Object.assign(body, wrapper);
        const recordId = crypto.uuid4();
        // Encrypted before the server has assigned this user an
        // identity, which is only possible because principal_id is not
        // part of the AAD.
        const slot = {
          recordId,
          recordType: 'profile',
          accountId: null,
          schemaVersion: SCHEMA_VERSION,
          version: 1,
        };
        const blob = await crypto.encryptRecord(dek, slot, {
          mainCurrency: currency.value,
          createdAt: new Date().toISOString(),
        });
        body.profileRecordId = recordId;
        body.profileSchemaVersion = SCHEMA_VERSION;
        body.profileCiphertext = blob.ciphertext;
        body.profileNonce = blob.nonce;
      }

      const answer = await api.post('/api/register', body);
      created = isVault
        ? { kind: answer.kind, username: body.username, masterKey: keys.masterKey, dek, wrapper }
        : { kind: answer.kind, username: body.username };
    } catch (failure) {
      fail(
        failure.status === 409
          ? 'That username is taken.'
          : failure.outOfMemory
            ? isVault
              ? 'This device does not have enough memory available right now. No vault was created and your invite link is still good. Close some other tabs and try again.'
              : 'This device does not have enough memory available right now. No account was created and your invite link is still good. Close some other tabs and try again.'
            : 'That did not go through. Your invite link is untouched and everything you typed is still here.',
      );
      submit.disabled = false;
      submit.textContent = isVault ? 'Create vault' : 'Create account';
      note.hidden = true;
      return;
    }

    // The password was for the derivation and the token for the one
    // request. Neither is wanted past this point, so neither stays in
    // a field or a variable while the vault is drawn.
    password.value = '';
    confirm.value = '';
    token = null;
    await onCreated(created);
  });

  function fail(text) {
    error.textContent = text;
    error.hidden = false;
  }

  return el('div', { class: 'outside' }, [form]);
}
