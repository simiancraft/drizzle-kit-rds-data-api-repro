import {
  bigserial,
  foreignKey,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  unique,
} from 'drizzle-orm/pg-core';

/**
 * Every element below exists to produce one specific catalog shape that
 * drizzle-kit's introspection reads. Nothing here is decorative: remove a
 * piece and the corresponding failure stops reproducing, which is exactly
 * why an empty or near-empty schema (such as the SST aws-drizzle example)
 * does not show these bugs.
 */

/** Enum: contributes rows whose pg_constraint / pg_type reads are affected. */
export const tenant_kind = pgEnum('tenant_kind', ['individual', 'organization']);

/**
 * bigserial gives this table an owned sequence, so introspection calls
 * pg_get_serial_sequence(), whose result is type `regclass`.
 */
export const tenants = pgTable('tenants', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  kind: tenant_kind('kind').notNull(),
  /** Array column with an EMPTY default, the ARRAY[] introspection case. */
  tags: text('tags').array().notNull().default([]),
});

/**
 * Composite primary key with columns declared in an order that differs from
 * their alphabetical order AND from their table position, so an introspection
 * query that omits ORDER BY ordinal_position reports the wrong column order
 * without erroring.
 */
export const regions = pgTable(
  'regions',
  {
    country_code: text('country_code').notNull(),
    region_code: text('region_code').notNull(),
    label: text('label').notNull(),
  },
  (t) => [
    primaryKey({ name: 'regions_pkey', columns: [t.region_code, t.country_code] }),
    unique('regions_label_country_unique').on(t.label, t.country_code),
  ],
);

/**
 * Multi-column foreign key referencing the composite key above. The referenced
 * column order differs from the referencing column order, so a introspection
 * that pairs conkey and confkey positionally without ordinality mis-pairs them.
 */
export const stores = pgTable(
  'stores',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenant_id: integer('tenant_id').notNull(),
    home_country: text('home_country').notNull(),
    home_region: text('home_region').notNull(),
  },
  (t) => [
    foreignKey({
      name: 'stores_region_fk',
      columns: [t.home_region, t.home_country],
      foreignColumns: [regions.region_code, regions.country_code],
    }),
  ],
);
