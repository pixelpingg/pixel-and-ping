# D1 migrations

`0001_init.sql` was hand-written to match `worker/src/db/schema.ts`
exactly, because `drizzle-kit generate` could not be run in the build
environment (no network access to install `drizzle-kit`'s dependencies).

## How parity was actually verified

Not by eyeballing it — by a script that parsed both files and compared
them programmatically:

- **Table names**: every `sqliteTable("...")` call in `schema.ts` vs.
  every `CREATE TABLE ...` in the SQL — 20 on each side, identical set.
- **Column names**: for each of the 20 tables, every `text("...")`/
  `integer("...")` column builder in `schema.ts` vs. every column
  declared in that table's `CREATE TABLE` body in the SQL — zero
  mismatches across all 20 tables.

This catches "forgot a column" or "typo'd a table name" errors, which is
the failure mode hand-writing SQL alongside a schema file is most prone
to. It does **not** catch every possible issue `drizzle-kit generate`
would (e.g. subtle type mapping edge cases) — treat the first real
`wrangler d1 migrations apply ... --local` as the actual test.

## Applying migrations

```bash
npx wrangler d1 migrations apply pixelping --local    # for `wrangler dev`
npx wrangler d1 migrations apply pixelping --remote   # for production
```

## Adding a new migration later

1. Edit `worker/src/db/schema.ts`.
2. If you have a working `drizzle-kit` toolchain: `npx drizzle-kit
   generate` will produce the next numbered migration file automatically
   — prefer this over hand-writing SQL once it's available to you.
3. Otherwise, hand-write `NNNN_description.sql` following the same
   naming convention as `0001_init.sql`, and re-run the same kind of
   parity check (or just carefully diff column-by-column) before trusting
   it.
