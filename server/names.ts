// Naming rules carried over from 1.x, so cranes made by either version get the same ids
// and their files the same names on disk.
import { existsSync } from 'node:fs';
import { extname, join } from 'node:path';

/**
 * Werkzeug's secure_filename, as 1.x used it for stored and original file names: ASCII
 * only, whitespace runs to "_", anything but letters, digits, "_", "." and "-" dropped,
 * and no leading or trailing "." or "_".
 */
export function secureFilename(name: string): string {
  const ascii = name.normalize('NFKD').replace(/[^\p{ASCII}]/gu, '');
  const joined = ascii.replaceAll('/', ' ').trim().split(/\s+/).join('_');
  return joined.replace(/[^A-Za-z0-9_.-]/g, '').replace(/^[._]+|[._]+$/g, '');
}

/**
 * The crane's id and folder name: make_type_model_capacity, lowercased, spaces and "/"
 * as "_", and anything but letters, digits, ".", "_" and "-" removed (letters include
 * accented ones, as Python's isalnum did).
 */
export function generateCraneId(make: string, type: string, model: string, capacity: string) {
  const joined = [make, type, model, capacity]
    .map((p) => p.replaceAll(' ', '_').replaceAll('/', '_').toLowerCase())
    .join('_');
  return joined.replace(/[^\p{L}\p{N}._-]/gu, '');
}

/** A safe on-disk name for an uploaded PDF, always ending in .pdf. */
export function storedNameFor(original: string): string {
  const name = secureFilename(original) || 'document.pdf';
  return name.toLowerCase().endsWith('.pdf') ? name : `${name}.pdf`;
}

/** `name`, or name_2, name_3 … if a file of that name is already in `dir`. */
export function dedupeStoredName(dir: string, name: string): string {
  if (!existsSync(join(dir, name))) return name;
  const ext = extname(name);
  const base = name.slice(0, name.length - ext.length);
  let i = 2;
  while (existsSync(join(dir, `${base}_${i}${ext}`))) i += 1;
  return `${base}_${i}${ext}`;
}

/** Local time as 1.x stored it (Python's datetime.now().isoformat()), so dates sort together. */
export function isoNow(date = new Date()): string {
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return (
    `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}` +
    `T${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}` +
    `.${p(date.getMilliseconds(), 3)}000`
  );
}
