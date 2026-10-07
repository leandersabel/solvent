// design-system.md, Typography, Figures: names in a sentence read
// "A, B and C". The rule sets how names join, not their order, so every
// order counts.
const orders = (names) => (names.length < 2
  ? [names]
  : names.flatMap((name, i) => orders([...names.slice(0, i), ...names.slice(i + 1)]).map((rest) => [name, ...rest])));

const joined = (order) => (order.length < 2 ? order.join('') : `${order.slice(0, -1).join(', ')} and ${order.at(-1)}`);

// Whether `text` names every one of `names` as the rule says.
export const lists = (text, names) => orders(names).some((order) => text.includes(joined(order)));

// Whether `text` chains any two of `names` with "and" before the last,
// as "A and B and C" does.
export const chains = (text, names) => orders(names).some((order) =>
  order.length > 2 && text.includes(`${order[0]} and ${order[1]} and `));
