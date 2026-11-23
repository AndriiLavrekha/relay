// Unit table shared by the duration helpers: [suffix, seconds], largest first.
export const UNITS = [['d', 86400], ['h', 3600], ['m', 60], ['s', 1]];

// formatDuration(5400) -> '1h30m'; 0 -> '0s'.
export function formatDuration(totalSeconds) {
  if (!Number.isInteger(totalSeconds) || totalSeconds < 0) throw new RangeError('totalSeconds must be a non-negative integer');
  if (totalSeconds === 0) return '0s';
  let rest = totalSeconds;
  let out = '';
  for (const [suffix, size] of UNITS) {
    const count = Math.floor(rest / size);
    if (count > 0) out += `${count}${suffix}`;
    rest -= count * size;
  }
  return out;
}
