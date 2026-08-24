import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';

export function sha256Buffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

export function sha256Text(text) {
  return sha256Buffer(Buffer.from(text, 'utf8'));
}

export async function sha256File(filePath) {
  return sha256Buffer(await readFile(filePath));
}
