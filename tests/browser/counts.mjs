// design-system.md, Typography, Figures: a count agrees with its noun.
// One reads in the singular, every other count, 0 included, in the
// plural.
const COUNTED = /(?<![\d.,'])(\d+(?:[',.   ]\d{3})*) (days?|holdings?|records?|recorded figures?|figures?|recorded values?|values?|captured prices?|prices?|dimensions?)\b/g;

// Every count in `text` whose noun disagrees with it.
export const disagreeing = (text) =>
  [...text.matchAll(COUNTED)]
    .filter(([, count, noun]) => (Number(count.replace(/\D/g, '')) === 1) === noun.endsWith('s'))
    .map(([phrase]) => phrase);
