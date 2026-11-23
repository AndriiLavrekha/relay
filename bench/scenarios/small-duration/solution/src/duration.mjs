import { UNITS } from './format.mjs';

// Inverse of formatDuration in ./format.mjs.
export function parseDuration(input) {
  if (typeof input !== 'string') throw new TypeError('duration must be a string');
  const text = input.trim().toLowerCase();
  if (!text) throw new RangeError('empty duration');
  const parts = text.split(/(?<=[dhms])\s*(?=\d)/);
  let total = 0;
  let last = -1;
  for (const part of parts) {
    const m = /^(\d+)([dhms])$/.exec(part);
    if (!m) throw new RangeError(`invalid duration part: ${part}`);
    const index = UNITS.findIndex(([suffix]) => suffix === m[2]);
    if (index <= last) throw new RangeError(`duplicate or out-of-order unit: ${m[2]}`);
    last = index;
    total += Number(m[1]) * UNITS[index][1];
  }
  return total;
}
