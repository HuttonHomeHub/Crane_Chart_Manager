import { createLock } from '@hhh/server';

// One lock around every change that touches files and the database together (an upload
// saves its file then inserts its rows; an edit renames the crane's folder and rows; a
// merge moves both), so two requests never interleave and a backup or restore never sees
// the two disagree.
export const withLock = createLock();
