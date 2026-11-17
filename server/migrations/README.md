# Migrations

Numbered SQL files, run in order at startup by the shared kit (`runMigrations` from
`@hhh/server`). Each runs in its own transaction and is recorded in `schema_migrations`
with its checksum. A database that already holds data is copied to
`premigrate-<time>.db` in the backup folder first.

`001-baseline.sql` is the schema the Python app (1.x) created, written with
`IF NOT EXISTS`, so a 1.x database opens unchanged. Never edit a migration once it is on
`dev`: startup stops if a recorded file changed. Add a new one instead.

Databases from before the multi-file model (a `specs` table, or `metadata.json`) were
migrated by the Python app; upgrade those through 1.9 first.
