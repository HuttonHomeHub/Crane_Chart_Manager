// The API's request and reply shapes, declared once for the server and the browser.
// The crane routes keep the 1.x (Python) JSON exactly, snake_case included, so the data,
// the bulk importer and anything scripted against the API carry over unchanged. The
// backup and instance-info routes use the shared standard's shapes (as PhotoMapper).

/** One PDF attached to a crane. */
export interface CraneFile {
  id: number;
  crane_id: string;
  stored_name: string;
  original_filename: string;
  label: string;
  uploaded_at: string;
  /** /uploads/<crane_id>/<stored_name> */
  url: string;
  is_primary: boolean;
}

/** One crane specification (make, type, model, capacity) and its files, primary first. */
export interface Crane {
  /** The slug make_type_model_capacity, also its uploads/ folder name. */
  id: string;
  /** The same as id (the sidebar keyed on it in 1.x). */
  name: string;
  make: string;
  type: string;
  model: string;
  capacity: string;
  uploaded_at: string;
  updated_at: string | null;
  files: CraneFile[];
  primary_file_id: number | null;
  file_count: number;
  /** The primary file's url and name, so one field opens the crane. */
  url: string | null;
  original_filename: string | null;
}

/** GET /api/pdfs[?after=<crane id>&limit=<n>] */
export interface CranePage {
  items: Crane[];
  total: number;
  next_cursor: string | null;
}

/** GET /api/facets */
export interface Facets {
  makes: string[];
  types: string[];
}

/** POST /api/merge-make {from, into} */
export interface MergeReply {
  success: true;
  moved: number;
  absorbed: number;
}

/** POST /api/upload, POST /api/cranes/:id/files, PUT …/primary, PATCH …/files/:fileId */
export type CraneReply = Crane & { success: true };

/** PUT /api/metadata/:id */
export type MetadataReply = Crane & { success: true; renamed: boolean; old_name: string };

/** DELETE /api/cranes/:id/files/:fileId */
export type DeleteFileReply =
  { success: true; crane_deleted: true } | (Crane & { success: true; crane_deleted: false });

/** GET /api/export: every crane, keyed by id. */
export type CatalogueExport = Record<string, Crane>;

/** Database row counts, in /api/info and the restore reply. */
export interface Counts {
  cranes: number;
  files: number;
}

/** GET /api/info */
export interface InstanceInfoReply {
  version: string;
  counts: Counts;
  paths: { database: string; uploads: string; backups: string };
  limits: {
    maxUploadMb: number;
    maxFieldLen: number;
    uploadRate: { limit: number; windowMs: number };
    writeRate: { limit: number; windowMs: number };
  };
  trustProxyHops: number;
}

/** GET /api/backup */
export interface BackupsReply {
  enabled: boolean;
  dir: string;
  intervalHours: number;
  keep: number;
  includeUploads: boolean;
  backups: Array<{ name: string; size: number; createdAt: string }>;
  scheduler: {
    enabled: boolean;
    intervalHours: number;
    lastSuccessAt?: string;
    lastError?: string;
    nextRunAt?: string;
  };
}

/** POST /api/backup */
export interface BackupNowReply {
  name: string;
  size: number;
}

/** POST /api/backup/restore */
export interface RestoreReply {
  safetyBackup: string;
  restoredUploads: boolean;
  counts: Counts;
}
