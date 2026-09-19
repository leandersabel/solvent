// The administration surface (spec/ui/admin.md).
//
// Every control here maps to a route under /api/admin/ or to the
// shared change-password endpoint. Nothing on it renders a figure, a
// balance or a holding's name, because none is reachable from this
// session.
import * as api from './api.js';
import { dialog, el, mount, shortDate } from './dom.js';
import { changePassword } from './session.js';
import { passwordWithToggle } from './unlock.js';
import { strengthGauge } from './strength.js';

const container = document.getElementById('app');
const username = container.dataset.username;
const kdf = JSON.parse(document.getElementById('kdf-envelope').textContent);

const SECTIONS = [
  ['invites', 'Invites'],
  ['accounts', 'Accounts'],
  ['units', 'Units'],
  ['password', 'Your password'],
];

let section = 'invites';

const BOUNDARY =
  'You can invite and remove people on this instance, and maintain the list of units a holding can be measured in. You cannot read anyone’s holdings, balances, notes, or history, you cannot reset anybody’s password, and you cannot recover a locked-out vault. Solvent holds no key that could, including for the vault behind your own user account.';

function render() {
  const body = el('div', {});
  mount(container, [
    el('p', { class: 'callout', text: BOUNDARY }),
    el(
      'nav',
      { class: 'section-switcher', 'aria-label': 'Admin sections' },
      SECTIONS.map(([id, label]) =>
        el('button', {
          class: section === id ? 'switcher-link active' : 'switcher-link',
          text: label,
          'aria-current': section === id ? 'page' : null,
          onclick: () => {
            section = id;
            render();
          },
        }),
      ),
    ),
    body,
  ]);

  if (section === 'invites') invites(body);
  if (section === 'accounts') accounts(body);
  if (section === 'units') unitTable(body);
  if (section === 'password') mount(body, passwordCard());
}

function invites(body) {
  const list = el('div', {}, [el('p', { class: 'hint', text: 'Loading…' })]);
  mount(body, [createInvite(() => loadInvites(list)), list]);
  loadInvites(list);
}

function createInvite(reload) {
  const kindUser = el('input', { type: 'radio', name: 'invite-kind', value: 'vault_owner', checked: true });
  const kindAdmin = el('input', { type: 'radio', name: 'invite-kind', value: 'administrator' });
  const adminNote = el('p', {
    class: 'hint',
    hidden: true,
    text: 'Whoever uses this link gets an administrator account. They can invite and remove people on this instance, and they get no vault of their own. They still cannot read anyone’s data, and neither can anybody else. If that person also wants to keep their own finances in Solvent, they need a separate invite for a user account.',
  });
  for (const radio of [kindUser, kindAdmin]) {
    radio.addEventListener('change', () => {
      adminNote.hidden = !kindAdmin.checked;
    });
  }
  const label = el('input', { type: 'text', placeholder: 'Sarah’s laptop' });
  const days = el('select', {}, [1, 3, 7, 14, 30].map((n) =>
    el('option', { value: String(n), text: `${n} days`, selected: n === 7 }),
  ));
  days.value = '7';
  const error = el('p', { class: 'field-error', hidden: true });
  const card = el('section', { class: 'card' });

  const button = el('button', {
    class: 'btn-primary',
    text: 'Create invite link',
    onclick: async () => {
      error.hidden = true;
      button.disabled = true;
      try {
        const invite = await api.post('/api/admin/invites', {
          kind: kindAdmin.checked ? 'administrator' : 'vault_owner',
          label: label.value,
          expiresInDays: Number(days.value),
        });
        showLink(card, invite, reload);
        reload();
      } catch {
        error.textContent = 'No link was made and nothing was consumed.';
        error.hidden = false;
        button.disabled = false;
      }
    },
  });

  mount(card, [
    el('h2', { class: 'section-heading', text: 'Create an invite' }),
    el('fieldset', {}, [
      el('legend', { text: 'This link creates' }),
      el('label', { class: 'checkbox' }, [kindUser, el('span', { text: 'A user account' })]),
      el('label', { class: 'checkbox' }, [kindAdmin, el('span', { text: 'An administrator account' })]),
      adminNote,
    ]),
    el('div', { class: 'field' }, [
      el('label', { text: 'A note to yourself' }),
      label,
      el('p', {
        class: 'hint',
        text: 'Only administrators see this, and Solvent stores it as you typed it. It is the one thing anybody types in Solvent that the server can read, so keep it to a nickname.',
      }),
    ]),
    el('div', { class: 'field' }, [el('label', { text: 'This link stops working after' }), days]),
    error,
    button,
  ]);
  return card;
}

function showLink(card, invite, reload) {
  const field = el('input', { type: 'text', value: invite.url, readonly: true });
  mount(card, [
    invite.kind === 'administrator'
      ? el('p', { class: 'strong', text: 'This is an administrator invite.' })
      : null,
    field,
    el('button', {
      class: 'btn-secondary',
      text: 'Copy',
      onclick: () => {
        field.select();
        navigator.clipboard.writeText(invite.url);
      },
    }),
    el('p', {
      class: 'hint',
      text: 'Copy this now. Solvent does not store the link and cannot show it again.',
    }),
    el('button', {
      class: 'btn-primary',
      text: 'Create another',
      onclick: () => {
        const fresh = createInvite(reload);
        card.replaceWith(fresh);
      },
    }),
  ]);
}

const STATUS_WORDS = {
  pending: 'Waiting',
  used: 'Used',
  expired: 'Expired',
  revoked: 'Called back',
};

async function loadInvites(list) {
  let rows;
  try {
    rows = await api.get('/api/admin/invites');
  } catch {
    mount(list, el('p', { class: 'field-error', text: 'The invite list would not load.' }));
    return;
  }
  if (!rows.length) {
    mount(list, el('p', { class: 'empty-line', text: 'No invite links yet.' }));
    return;
  }
  mount(
    list,
    el('table', { class: 'data-table' }, [
      el('thead', {}, [
        el('tr', {}, ['Kind', 'Note', 'Created', 'Stops working', 'Status', ''].map((head) => el('th', { text: head }))),
      ]),
      el(
        'tbody',
        {},
        rows.map((row) =>
          el('tr', { class: row.status === 'pending' ? null : 'dimmed' }, [
            el('td', {}, [
              el('span', {
                class: 'chip',
                text: row.kind === 'administrator' ? 'Administrator' : 'User',
              }),
            ]),
            el('td', { text: row.label || 'None' }),
            el('td', { text: shortDate(row.createdAt.slice(0, 10)) }),
            el('td', { text: shortDate(row.expiresAt.slice(0, 10)) }),
            el('td', {}, [
              el('span', { class: 'chip', text: STATUS_WORDS[row.status] }),
              row.usedBy ? el('span', { text: ` ${row.usedBy}` }) : null,
            ]),
            el('td', {}, [
              row.status === 'pending'
                ? el('button', {
                    class: 'btn-inline',
                    text: 'Call back',
                    onclick: () => callBack(row, list),
                  })
                : row.status === 'used'
                  ? el('span', { class: 'hint', text: 'Already used. Remove the account instead.' })
                  : null,
            ]),
          ]),
        ),
      ),
    ]),
  );
}

function callBack(row, list) {
  const close = dialog({
    heading: 'Call back this link?',
    body: [
      el('p', {
        text: 'Calling back this link stops it working immediately, even though it has time left. Anybody holding it will be turned away.',
      }),
    ],
    actions: [
      el('button', { class: 'btn-secondary', text: 'Cancel', onclick: () => close() }),
      el('button', {
        class: 'btn-destructive',
        text: 'Call it back',
        onclick: async () => {
          close();
          await api.post(`/api/admin/invites/${row.id}/revoke`, {});
          loadInvites(list);
        },
      }),
    ],
  });
}

async function accounts(body) {
  mount(body, el('p', { class: 'hint', text: 'Loading…' }));
  let rows;
  try {
    rows = await api.get('/api/admin/accounts');
  } catch {
    mount(body, el('p', { class: 'field-error', text: 'The account list would not load.' }));
    return;
  }
  const administrators = rows.filter((row) => row.kind === 'administrator').length;

  mount(
    body,
    el('section', { class: 'card' }, [
      el('h2', { class: 'section-heading', text: 'Accounts' }),
      el('table', { class: 'data-table' }, [
        el('thead', {}, [
          el('tr', {}, ['Username', 'Kind', 'Created', 'Last signed in', 'Items', ''].map((head) => el('th', { text: head }))),
        ]),
        el(
          'tbody',
          {},
          rows.map((row) =>
            el('tr', {}, [
              el('td', { text: row.username }),
              el('td', {}, [
                el('span', {
                  class: 'chip',
                  text: row.kind === 'administrator' ? 'Administrator' : 'User',
                }),
              ]),
              el('td', { text: shortDate(row.createdAt.slice(0, 10)) }),
              el('td', {
                text: row.lastLoginAt ? shortDate(row.lastLoginAt.slice(0, 10)) : 'Never',
              }),
              // Zero and "there is nothing to count" are different
              // statements, and a zero invites the reader to think a
              // vault is sitting there empty.
              el('td', {
                class: 'muted',
                text: 'recordCount' in row ? String(row.recordCount) : 'No vault',
              }),
              el('td', {}, [
                row.kind === 'administrator' && administrators === 1
                  ? el('span', {
                      class: 'hint',
                      text: 'The only administrator. Invite another one before removing this account.',
                    })
                  : el('button', {
                      class: 'btn-destructive',
                      text: 'Remove',
                      onclick: () => removeAccount(row, body),
                    }),
              ]),
            ]),
          ),
        ),
      ]),
    ]),
  );
}

function removeAccount(row, body) {
  const typed = el('input', { type: 'text' });
  const error = el('p', { class: 'field-error', hidden: true });
  const confirm = el('button', {
    class: 'btn-destructive',
    text: 'Remove account',
    disabled: true,
    onclick: async () => {
      try {
        await api.del(`/api/admin/accounts/${row.username}`, {
          confirmUsername: row.username,
        });
        close();
        if (row.username === username) window.location.href = '/login';
        else accounts(body);
      } catch (failure) {
        error.textContent =
          failure.status === 409
            ? 'The only administrator. Invite another one before removing this account.'
            : failure.status === 404
              ? 'That account is no longer on this instance.'
              : 'Nothing was removed.';
        error.hidden = false;
      }
    },
  });
  typed.addEventListener('input', () => {
    confirm.disabled = typed.value !== row.username;
  });

  const lines =
    row.kind === 'administrator'
      ? [
          'This deletes the administrator account and every session it has open. There is no vault and nothing encrypted, so nothing becomes unreadable. A replacement is made by inviting one.',
        ]
      : [
          'This deletes the account, everything in its vault, and every session it has open. It happens all at once and it cannot be undone.',
          'Solvent cannot save you a copy first. It cannot read what is in there.',
        ];
  if (row.username === username) {
    lines.push('This is the account you are signed in as. Removing it signs you out immediately.');
    lines.push('Any user account you hold is a separate account and is not touched.');
  }

  const cancel = el('button', { class: 'btn-secondary', text: 'Cancel', onclick: () => close() });
  const close = dialog({
    heading: `Remove ${row.username}?`,
    body: [
      ...lines.map((line) => el('p', { text: line })),
      el('div', { class: 'field' }, [
        el('label', { text: 'Type the username to confirm' }),
        typed,
      ]),
      error,
    ],
    actions: [cancel, confirm],
  });
  cancel.focus();
}

async function unitTable(body) {
  mount(body, el('p', { class: 'hint', text: 'Loading…' }));
  let rows;
  try {
    rows = await api.get('/api/admin/symbols');
  } catch {
    mount(body, el('p', { class: 'field-error', text: 'The unit list would not load.' }));
    return;
  }
  const live = rows.filter((row) => !row.retired);
  const retired = rows.filter((row) => row.retired);

  mount(body, [
    el('section', { class: 'card' }, [
      el('h2', { class: 'section-heading', text: 'Units' }),
      el('table', { class: 'data-table' }, [
        el('thead', {}, [
          el('tr', {}, ['Code', 'Name', 'Kind', 'Rate lookup', ''].map((head) => el('th', { text: head }))),
        ]),
        el('tbody', {}, live.map((row) => unitRow(row, body))),
      ]),
      retired.length
        ? el('details', {}, [
            el('summary', { text: 'Retired' }),
            el('table', { class: 'data-table' }, [
              el('tbody', {}, retired.map((row) => unitRow(row, body))),
            ]),
          ])
        : null,
      addUnit(body),
    ]),
  ]);
}

function unitRow(row, body) {
  const error = el('p', { class: 'field-error', hidden: true });
  const name = el('input', { type: 'text', value: row.label, class: 'inline-input' });
  name.addEventListener('blur', async () => {
    if (name.value === row.label || !name.value.trim()) {
      name.value = row.label;
      return;
    }
    try {
      await api.patch(`/api/admin/symbols/${row.symbol}`, { label: name.value.trim() });
      row.label = name.value.trim();
    } catch {
      name.value = row.label;
      error.textContent = 'That rename did not save.';
      error.hidden = false;
    }
  });

  const lookup = el('select', {}, [
    el('option', { value: 'true', text: 'Automatic' }),
    el('option', { value: 'false', text: 'Entered by hand' }),
  ]);
  lookup.value = String(row.lookup);
  lookup.disabled = !row.hasAdapter;
  lookup.addEventListener('change', async () => {
    try {
      await api.patch(`/api/admin/symbols/${row.symbol}`, { lookup: lookup.value === 'true' });
      row.lookup = lookup.value === 'true';
    } catch {
      lookup.value = 'false';
      error.textContent =
        'The source for this unit is no longer configured on the server. Reload to see the current list.';
      error.hidden = false;
    }
  });

  return el('tr', { class: row.retired ? 'dimmed' : null }, [
    el('td', { class: 'numeric' }, [
      el('span', { text: row.symbol }),
      row.retired ? el('span', { class: 'chip', text: 'Retired' }) : null,
    ]),
    el('td', {}, [name, error]),
    el('td', { text: row.kind === 'currency' ? 'Currency' : 'Metal' }),
    el('td', {}, [
      lookup,
      row.hasAdapter
        ? null
        : el('span', {
            class: 'hint',
            text: 'No source for this unit yet. Rate lookup can be turned on once one is configured on the server.',
          }),
    ]),
    el('td', {}, [
      el('button', {
        class: 'btn-inline',
        text: row.retired ? 'Restore' : 'Retire',
        onclick: () => retireUnit(row, body),
      }),
    ]),
  ]);
}

function retireUnit(row, body) {
  const restoring = row.retired;
  const close = dialog({
    heading: restoring ? `Restore ${row.symbol}?` : `Retire ${row.symbol}?`,
    body: restoring
      ? [el('p', { text: 'This puts it back in the list people choose from, exactly as it was.' })]
      : [
          el('p', {
            text: 'This takes it out of the list people choose from when they set up a holding. Holdings already measured in it keep working and keep getting rates, and nothing is renamed.',
          }),
          el('p', {
            text: 'Solvent cannot tell you how many holdings use it. A unit lives inside vault data, which it cannot read.',
          }),
          el('p', { text: 'You can put it back at any time.' }),
        ],
    actions: [
      el('button', { class: 'btn-secondary', text: 'Cancel', onclick: () => close() }),
      el('button', {
        class: 'btn-primary',
        text: restoring ? 'Restore' : 'Retire',
        onclick: async () => {
          close();
          await api.patch(`/api/admin/symbols/${row.symbol}`, { retired: !restoring });
          unitTable(body);
        },
      }),
    ],
  });
}

function addUnit(body) {
  const code = el('input', { type: 'text' });
  const name = el('input', { type: 'text' });
  const kind = el('select', {}, [
    el('option', { value: 'currency', text: 'Currency' }),
    el('option', { value: 'metal', text: 'Metal' }),
  ]);
  const error = el('p', { class: 'field-error', hidden: true });

  return el('details', {}, [
    el('summary', { text: 'Add a unit' }),
    el('div', { class: 'field' }, [
      el('label', { text: 'Code' }),
      code,
      el('p', {
        class: 'hint',
        text: 'A code is permanent. It is written inside people’s vaults as the unit a holding is measured in, and Solvent cannot read those to change it afterwards. Check it before you add it.',
      }),
      el('p', {
        class: 'hint',
        text: 'Metals are named <code>-ozt or <code>-g, such as XAU-ozt.',
      }),
    ]),
    el('div', { class: 'field' }, [el('label', { text: 'Name' }), name]),
    el('div', { class: 'field' }, [el('label', { text: 'Kind' }), kind]),
    error,
    el('button', {
      class: 'btn-primary',
      text: 'Add the unit',
      onclick: async () => {
        error.hidden = true;
        try {
          await api.post('/api/admin/symbols', {
            symbol: code.value.trim(),
            label: name.value.trim(),
            kind: kind.value,
            lookup: false,
          });
          unitTable(body);
        } catch (failure) {
          error.textContent =
            failure.status === 409
              ? 'That code already exists.'
              : 'That is not a valid code. Use letters, digits, dots, dashes and underscores, starting with a letter or digit.';
          error.hidden = false;
        }
      },
    }),
  ]);
}

function passwordCard() {
  const current = el('input', { type: 'password', autocomplete: 'current-password' });
  const next = el('input', { type: 'password', autocomplete: 'new-password' });
  const confirm = el('input', { type: 'password', autocomplete: 'new-password' });
  const error = el('p', { class: 'field-error', hidden: true });
  const done = el('p', { class: 'banner', hidden: true, role: 'status' });
  const button = el('button', { class: 'btn-primary', text: 'Change password', disabled: true });
  const gauge = strengthGauge(next, (ok) => {
    button.disabled = !ok;
  });

  button.addEventListener('click', async () => {
    error.hidden = true;
    done.hidden = true;
    if (next.value !== confirm.value) {
      error.textContent = 'The two new passwords do not match.';
      error.hidden = false;
      return;
    }
    if (next.value === current.value) {
      error.textContent = 'The new password is your current one.';
      error.hidden = false;
      return;
    }
    button.disabled = true;
    button.textContent = 'Changing your password';
    try {
      await changePassword(username, current.value, next.value, kdf);
      current.value = next.value = confirm.value = '';
      done.textContent =
        'Your password is changed. Every other session of yours was signed out, and this one is still open.';
      done.hidden = false;
    } catch (failure) {
      error.textContent =
        failure.status === 400
          ? 'That is not your current password.'
          : 'Nothing was changed. Your current password still works.';
      error.hidden = false;
    } finally {
      button.disabled = false;
      button.textContent = 'Change password';
    }
  });

  return el('section', { class: 'card' }, [
    el('h2', { class: 'section-heading', text: 'Your password' }),
    el('p', {
      class: 'hint',
      text: 'This protects the power to remove every account on this instance, so it is held to the same bar as anybody else’s.',
    }),
    el('div', { class: 'field' }, [el('label', { text: 'Current password' }), passwordWithToggle(current)]),
    el('div', { class: 'field' }, [el('label', { text: 'New password' }), passwordWithToggle(next)]),
    gauge.element,
    el('div', { class: 'field' }, [el('label', { text: 'Confirm new password' }), passwordWithToggle(confirm)]),
    error,
    done,
    button,
  ]);
}

const signOutButton = document.getElementById('chrome-signout');
if (signOutButton) {
  signOutButton.addEventListener('click', () =>
    api.post('/api/auth/logout', {}).finally(() => {
      window.location.href = '/login';
    }),
  );
}

render();
