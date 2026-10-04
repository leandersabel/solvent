# Record API

One type-agnostic store for every encrypted record a vault owner holds:
`account`, `snapshot`, `rate` and `profile`. The server has no per-type
logic, because it cannot read any type. It has no screen, and every
feature that keeps vault data is built on it.

## How it works

### What it does

**Every route here is on the vault surface** (`app-shell.md`, The two
surfaces), so an administrator session gets Not Found from all of them.
Not an empty list, which is the plausible wrong answer and reads as
"your vault is empty" rather than "you have none". The schema refuses a
`records` row whose principal is an administrator, so nothing sits
behind the route for a mistake to reach either.

### Row shape

The columns are architecture.md, Record storage API.

- `record_type` is one of `account`, `snapshot`, `rate`, `profile`. An
  unknown value is rejected, so the vocabulary stays closed although
  the server cannot read the payload.
- `account_id` is required and non-empty **exactly for `snapshot`**, and
  empty for every other type. The server enforces it, because the
  column is plaintext. It is stated as the complement, so a type added
  later is empty until something argues otherwise.
- **The column set does not grow per type.** A `rate` record's symbol
  stays inside the ciphertext. There is no plaintext `symbol` or `date`
  column, for the reasons `record-rate.md` gives.
- `nonce` must differ from the row's previous nonce on every write.
- The primary key is `(principal_id, record_id)`. A `record_id` is a
  client-generated UUIDv4, unique only within one vault.

### The AAD encoding

The AAD (architecture.md, Key management) is byte-exact, so its order
and encoding are pinned here. Two implementations that disagree produce
a vault that never decrypts.

- **Field order** is Key management's:
  `account_id ‖ record_type ‖ record_id ‖ schema_version ‖ version`. It
  differs from the storage table's column order, and Key management
  wins.
- **Encoding**: each field as UTF-8 text, joined with a single `0x1f`
  byte (ASCII unit separator). The separator is required, because bare
  concatenation lets two different tuples produce the same AAD.
- An empty `account_id` is the empty string, not the literal `null`, and
  still contributes its separator. On the wire the same absence is
  `null` (`accountId` on the wire).
- `schema_version` and `version` are unpadded decimal.
- **A new record type changes no byte of this encoding.** `rate` carries
  the empty `account_id` that `account` and `profile` carry.
- Without `principal_id`, the client builds a record's AAD entirely from
  values it chose or already holds, so a vault can be encrypted before
  the server has given the account an identity (`register.md`).

**No request or response carries an `aad` field**, and a body carrying
one is rejected rather than ignored. Sending it would invite a server
that trusts the client's copy of values it already holds. The server
cannot verify the AAD used at encryption time. A wrong AAD surfaces only
when the client fails to decrypt, which is the tripwire it is there to
be.

What the server does enforce is **field consistency**, before storing.
It checks the body's `recordType`, `accountId`, `schemaVersion` and
`version` against the path's `record_id` and the stored row's immutable
columns. `recordType` and `accountId` never change. A mismatch is a Bad
Request, so no blob is stored whose claimed slot disagrees with the slot
it goes into. `POST /api/import` runs every record through this same
validator (`export-import.md`).

### `accountId` on the wire

`null` when absent, everywhere: the `PUT` body, the `GET` response and
the export file's records, so import has one case to map. An empty
string is a Bad Request rather than a second spelling of absent. Building
the AAD is the one place `null` becomes `""`, on both sides.

### Schema migration

`schema_version` is bumped when a record type's **plaintext** shape
changes. **Version 1 is the current shape and there is nothing below
it.** The server cannot read a payload, so migration is client-side and
**lazy**:

1. On read, a record below the client's current version for its type
   runs through an ordered chain of pure functions in memory.
2. The result is used at once. **Nothing is written back.**
3. The record persists in the new shape on its next legitimate save,
   which bumps `version` and `schema_version` together.

So there is no migration event and no vault is ever half-migrated. The
AAD changes only when a record legitimately changes, where a bulk
rewrite would re-encrypt everything and make `version` stop counting
real edits. A record never read is never migrated, because only reading
makes its shape matter. The functions work on decrypted plaintext, so
they are unit-testable without crypto, and import reuses the chain for
an older `formatVersion` file (`export-import.md`).

A `schema_version` **higher** than the client knows makes the record
unreadable: skipped, counted and surfaced by the same warning as a
decryption failure (`net-worth-view.md`). Guessing at a future shape is
how data gets silently corrupted.

### Endpoints

All are session-authenticated, writes need the CSRF header
(architecture.md, Application hardening), and every body is
Pydantic-validated. Each compares the vault epoch inside its own
transaction, `GET` included (architecture.md, Vault epoch).

There is deliberately **no single-record `GET`.** The client fetches
every record once per session and keeps the model in memory
(`net-worth-view.md`, Data flow), so a stale-version reload refetches
that record's whole type. Where a screen says it "reloads the current
record", this is what that means. A by-id endpoint would also hand the
server a per-record access pattern it cannot see today.

- **`GET /api/records?type=<t>`** returns every record of that type
  belonging to the session user, as `{ recordId, recordType, accountId,
  schemaVersion, version, nonce, ciphertext }`. `type` is required and
  must be a known value, one type per request.
- **`PUT /api/records/<record_id>`** creates or updates. The body
  carries `recordType`, `accountId`, `schemaVersion`, `version`, `nonce`
  and `ciphertext`, where `version` is the version being written. A
  create carries 1 with no row present, an update exactly the stored
  version + 1. Anything else is a Conflict with no `refused` member and
  nothing written, so a stale tab never silently overwrites a newer
  write. Changing an immutable column is a Bad Request. A row is keyed
  by `principal_id` and `record_id`, so an id another user holds is a
  create in the caller's own vault.
- **`DELETE /api/records/<record_id>`** deletes one record. A record
  that does not exist, or is another user's, is Not Found.

`DELETE /api/accounts/<account_id>?mode=purge` is the one deliberately
type-aware exception, because cascading a delete across a snapshot set
must be atomic and the server can see `account_id`. `manage-accounts.md`
owns it.

### Rules

- **`principal_id` always comes from the session** (architecture.md,
  Record storage API), whether the client puts it in the path, body,
  header or query. A body carrying `principalId` is rejected outright
  rather than ignored, so the mistake surfaces in a test and not in
  production.
- A record of another account is Not Found, never Forbidden, as with
  purge, so an attacker cannot map which ids exist.
- The storage caps (architecture.md, Storage & data handling) are
  checked before the row reaches the database.
- `updated_at` is set server-side, never accepted from the client.
- The server never inspects, parses or logs `ciphertext`.
- Writes are transactional per request. A rejected write leaves the
  stored row byte-identical.

## Edge cases

- **A `record_id` that is not a well-formed UUIDv4** is a Bad Request.
  It is validated as a shape, not trusted as an identity.
- **A `snapshot` with `accountId: null`**, any other type with one set,
  or `accountId: ""` on any type, is a Bad Request.
- **An `accountId` naming no `account` row of this user** is a Bad
  Request, which the server can check because the column is plaintext.
- **Two tabs write one record at once.** The second gets the Conflict
  and reloads. Nothing attempts a merge. A page holding a DEK an import
  replaced instead closes the vault (`login.md`, A vault replaced
  elsewhere).
- **A second `profile` record** is allowed by the schema and is a client
  bug. A singleton rule would be the only per-type rule in a
  type-agnostic store. Clients treat the highest `version` as
  authoritative.
- **Quota exhausted mid-session.** Writes get Content Too Large and
  reads keep working, so a vault is never locked away by its own size.
- **A request body over the size cap** is rejected at the framework
  layer before parsing.

## Acceptance criteria

1. A `PUT` at `version` 1 creates a row, and the same `PUT` repeated
   returns Conflict and increments nothing. Test:
   `tests/test_records.py::test_a_create_at_version_one_stores_a_row_and_a_repeat_conflicts`.
2. (blind) A `PUT` at the stored `version` + 1 succeeds. At the stored
   version, at + 2, or at 1 for an existing row, it returns Conflict and
   the row read back is byte-identical, not only the status checked.
   Test: `tests/test_records.py::test_only_stored_version_plus_one_is_accepted`.
3. (blind) The Conflict of a stale or occupied version carries no
   `refused` member, and a replaced-epoch Conflict carries
   `vault-replaced`, shown by parsing both bodies. Test: no test.
4. (blind) With the vault epoch replaced, a `GET`, a create `PUT`, an
   update `PUT` and a `DELETE` each answer Conflict
   `{"refused":"vault-replaced"}`, return no record, and leave `records`
   row for row as it was. The `GET` is covered as well as the writes.
   Test: `tests/test_vault_epoch.py::test_a_page_holding_the_replaced_key_never_reaches_the_vault`.
5. (blind) An import committing after a `PUT` or `DELETE` passed the
   request gate and before its transaction began makes that request
   answer `vault-replaced` and write nothing, asserted by holding the
   handler at that point. Test:
   `tests/test_vault_epoch.py::test_an_import_between_the_gate_and_the_transaction_makes_the_write_answer_replaced`.
6. `GET /api/records?type=account` returns only the session user's
   records, only of that type. With two users holding records, neither
   sees a row of the other's. Test:
   `tests/test_records.py::test_neither_of_two_vaults_sees_a_row_of_the_others`.
7. A `DELETE` naming another user's `record_id` returns Not Found and
   changes nothing. Test:
   `tests/test_records.py::test_reaching_another_vaults_record_is_not_found_never_forbidden`.
8. A `PUT` naming another user's `record_id` writes a row in the
   caller's own vault and leaves the other user's row as it was. Test:
   `tests/test_records.py::test_reaching_another_vaults_record_is_not_found_never_forbidden`.
9. (blind) An administrator session gets Not Found, not an empty list,
   from `GET /api/records`. Test:
   `tests/test_guard.py::test_an_administrator_gets_not_found_from_records_not_an_empty_list`.
10. (blind) A body carrying a `principalId` field is rejected outright,
    not stripped and ignored, and no row is written under either user.
    Test: `tests/test_records.py::test_a_principal_id_or_aad_field_is_rejected_outright`.
11. (blind) A body carrying an `aad` field is rejected outright, not
    stripped and ignored. Test:
    `tests/test_records.py::test_a_principal_id_or_aad_field_is_rejected_outright`.
12. An unauthenticated request to any endpoint here returns
    Unauthorized. Test:
    `tests/test_guard.py::test_every_api_route_is_forbidden_without_the_header_and_unauthorized_without_a_session`.
13. A write without the `X-Solvent-Request` header returns Forbidden.
    Test: `tests/test_guard.py::test_every_api_route_is_forbidden_without_the_header_and_unauthorized_without_a_session`.
14. A cross-origin attempt to send the `X-Solvent-Request` header never
    reaches the endpoint, because the preflight fails. Test: no test.
15. Two successive writes to one record produce different nonces, and a
    write reusing the row's previous nonce is refused. Test:
    `tests/test_records.py::test_two_successive_writes_produce_different_nonces`,
    `tests/test_records.py::test_reusing_the_previous_nonce_is_refused`.
16. (blind) A `PUT` whose body disagrees with the path `record_id` or
    with the stored row's immutable columns is a Bad Request, and the
    row read back is byte-identical. Test:
    `tests/test_records.py::test_an_immutable_column_cannot_change`.
17. (blind) The AAD for a known tuple matches a stored fixture byte for
    byte, including every separator and the empty `account_id`. The
    fixture is checked in as bytes, never recomputed with the helper
    under test. Test:
    `tests/test_records.py::test_the_aad_matches_the_stored_fixture_byte_for_byte`,
    `tests/test_records.py::test_an_empty_account_id_is_the_empty_string_and_still_contributes_a_separator`.
18. The AAD contains no user identifier in any form, asserted against
    the fixture. Test:
    `tests/test_records.py::test_the_aad_contains_no_user_identifier`.
19. A record encrypted by one user and inserted directly into another
    user's rows fails to decrypt under that user's DEK. The DEK boundary
    carries this, not the AAD. Test: no test.
20. A `snapshot` `PUT` with `accountId: null`, and an `account` or
    `rate` `PUT` with one set, are each a Bad Request. Test:
    `tests/test_records.py::test_account_id_is_required_exactly_for_snapshot`.
21. A `PUT` with `accountId: ""` is a Bad Request on any type. Test:
    `tests/test_records.py::test_an_empty_string_account_id_is_a_bad_request_on_any_type`.
22. A `PUT` whose `accountId` names no `account` row of this user is a
    Bad Request. Test:
    `tests/test_records.py::test_an_account_id_naming_no_account_row_is_a_bad_request`.
23. (blind) The AAD fixture is byte-identical with `rate` in the type
    vocabulary and without it, asserted against the stored fixture
    rather than a recomputation. Test:
    `tests/test_records.py::test_the_rate_type_moves_no_byte_of_the_encoding`.
24. (blind) `accountId` is `null`, never `""`, in a `GET /api/records`
    response and in an exported file, each asserted on its own, because
    different code paths write them. Test:
    `tests/test_records.py::test_account_id_is_null_and_never_empty_in_a_get_response`,
    `tests/test_records.py::test_account_id_is_null_and_never_empty_in_an_exported_file`.
25. (blind) A ciphertext over the per-record cap, a vault over the
    record-count cap and a user over the byte quota each return Content
    Too Large with nothing written, checked by reading the rows back.
    A ciphertext at the cap is accepted. Test:
    `tests/test_records.py::test_a_ciphertext_over_the_per_record_cap_is_content_too_large`,
    `tests/test_records.py::test_the_record_count_cap_is_enforced`.
26. A `record_id` that is not a well-formed UUIDv4 is a Bad Request.
    Test: `tests/test_records.py::test_a_malformed_record_id_is_a_bad_request`.
27. (blind) A record stored at an older `schema_version` is readable,
    and reading it writes nothing: `version`, `nonce` and `ciphertext`
    compared before and after are byte-identical, not only the payload
    checked for its new shape. Test:
    `tests/test_records.py::test_reading_a_record_at_an_older_schema_version_writes_nothing`.
28. A migrated record persists in the new shape only on its next save,
    when `schema_version` and `version` both advance. Test: no test.
29. A record at a `schema_version` higher than the client knows is
    skipped and counted in the same warning as an undecryptable record,
    never guessed at. Test: no test.
30. Each migration function is unit-tested on decrypted plaintext with
    no crypto involved. Test:
    `tests/test_client.py::test_the_client_side_rules_hold`.
31. (blind) No log line contains a `ciphertext` value, checked on the
    captured log output of a real write, not by a grep of the source.
    Test: `tests/test_records.py::test_no_log_line_contains_a_ciphertext_value`.
