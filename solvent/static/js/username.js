// The username rule, the browser's copy of the server's
// (spec/features/register.md, Rules). tests/fixtures/usernames.json is
// run through this and through the server's normalization, so the two
// cannot drift unnoticed.

const ALLOWED = /^[a-z0-9._-]{3,32}$/;
const OUTSIDE_THE_SET = /[^a-z0-9._-]/;

export const HINT = 'Use 3 to 32 characters: letters a to z, digits, dot, underscore or hyphen.';
export const NOT_ACCEPTED = `This username was not accepted. ${HINT}`;

const normalize = (raw) => raw.trim().toLowerCase();

/** The stored form of a username, or null when it breaks the rule.
 *  The `system:bootstrap` sentinel breaks it because a colon is outside
 *  the set. */
export function normalizeUsername(raw) {
  const name = normalize(raw);
  return ALLOWED.test(name) ? name : null;
}

/** What is wrong with a value being typed, or null. A character
 *  outside the set is named before the length, because removing it may
 *  fix the length too. Too short is only a mistake once the field has
 *  been left (`blurred`), and an empty field is never one. */
export function usernameProblem(raw, blurred) {
  const name = normalize(raw);
  if (OUTSIDE_THE_SET.test(name)) return 'Only letters a to z, digits, dot, underscore and hyphen are allowed.';
  if (name.length > 32) return 'That is more than 32 characters.';
  if (blurred && name.length > 0 && name.length < 3) return 'Use at least 3 characters.';
  return null;
}
