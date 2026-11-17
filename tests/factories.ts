// Test data shaped like the API's replies.
import type { Crane, CraneFile } from '../shared/api.ts';

let nextFileId = 1;

export function craneFile(craneId: string, over: Partial<CraneFile> = {}): CraneFile {
  const stored = over.stored_name ?? 'chart.pdf';
  return {
    id: nextFileId++,
    crane_id: craneId,
    stored_name: stored,
    original_filename: stored,
    label: '',
    uploaded_at: '2026-01-01T09:00:00.000000',
    url: `/uploads/${craneId}/${stored}`,
    is_primary: true,
    ...over,
  };
}

/** A crane with one primary file; pass `files` labels to add more. */
export function crane(
  over: Partial<Pick<Crane, 'make' | 'type' | 'model' | 'capacity'>> = {},
  labels: string[] = []
): Crane {
  const make = over.make ?? 'Liebherr';
  const type = over.type ?? 'Mobile';
  const model = over.model ?? 'LTM1100';
  const capacity = over.capacity ?? '100t';
  const id = [make, type, model, capacity]
    .join('_')
    .replaceAll(' ', '_')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}._-]/gu, '');
  const files = [
    craneFile(id),
    ...labels.map((label, i) =>
      craneFile(id, { label, stored_name: `extra${i}.pdf`, is_primary: false })
    ),
  ];
  const primary = files[0];
  return {
    id,
    name: id,
    make,
    type,
    model,
    capacity,
    uploaded_at: '2026-01-01T09:00:00.000000',
    updated_at: null,
    files,
    primary_file_id: primary?.id ?? null,
    file_count: files.length,
    url: primary?.url ?? null,
    original_filename: primary?.original_filename ?? null,
  };
}
