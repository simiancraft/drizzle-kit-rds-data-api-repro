#!/usr/bin/env bun
/**
 * Create the reproduction catalog with plain DDL over the Data API.
 *
 * Deliberately NOT created with drizzle-kit: the bugs under test are in
 * kit's INTROSPECTION of an existing catalog, so the catalog has to exist
 * independently of the tool being tested.
 *
 * Mirrors src/schema.ts exactly. Idempotent.
 */

import { run } from './data-api';

const statements = [
  'DROP TABLE IF EXISTS stores',
  'DROP TABLE IF EXISTS regions',
  'DROP TABLE IF EXISTS tenants',
  'DROP TYPE IF EXISTS tenant_kind',

  `CREATE TYPE tenant_kind AS ENUM ('individual', 'organization')`,

  // bigserial gives tenants an owned sequence, so introspection calls
  // pg_get_serial_sequence(), whose result type is regclass.
  `CREATE TABLE tenants (
     id bigserial PRIMARY KEY,
     kind tenant_kind NOT NULL,
     tags text[] NOT NULL DEFAULT '{}'
   )`,

  // Composite primary key whose column order differs from both alphabetical
  // order and table position, plus a composite unique constraint.
  `CREATE TABLE regions (
     country_code text NOT NULL,
     region_code text NOT NULL,
     label text NOT NULL,
     CONSTRAINT regions_pkey PRIMARY KEY (region_code, country_code),
     CONSTRAINT regions_label_country_unique UNIQUE (label, country_code)
   )`,

  // Multi-column foreign key whose referencing column order differs from the
  // referenced column order.
  `CREATE TABLE stores (
     id bigserial PRIMARY KEY,
     tenant_id integer NOT NULL,
     home_country text NOT NULL,
     home_region text NOT NULL,
     CONSTRAINT stores_region_fk FOREIGN KEY (home_region, home_country)
       REFERENCES regions (region_code, country_code)
   )`,
];

for (const sql of statements) {
  await run(sql);
  console.log(`ok: ${sql.split('\n')[0].trim().slice(0, 70)}`);
}
console.log('\nCatalog ready. Now run: bun run repro:pull');
