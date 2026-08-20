#!/usr/bin/env bun
/**
 * Isolate each failure to a single expression.
 *
 * drizzle-kit's `pull` exits 1 without printing anything (its progress
 * renderer swallows the exception), so these probes issue the same
 * expressions its introspection selects, one at a time, straight over the
 * Data API. Each probe names the drizzle-kit query it comes from.
 */

import { redact, run } from './data-api';

type Probe = { name: string; sql: string; note: string };

const probes: Probe[] = [
  {
    name: 'A. contype (Postgres type "char")',
    sql: `SELECT con.contype AS constraint_type FROM pg_constraint con
          JOIN pg_class rel ON rel.oid = con.conrelid
          WHERE rel.relnamespace = 'public'::regnamespace LIMIT 1`,
    note: 'drizzle-kit selects con.contype uncast when introspecting constraints.',
  },
  {
    name: 'B. contype cast to text (the fix)',
    sql: `SELECT con.contype::text AS constraint_type FROM pg_constraint con
          JOIN pg_class rel ON rel.oid = con.conrelid
          WHERE rel.relnamespace = 'public'::regnamespace LIMIT 1`,
    note: 'Same query with ::text. Expected to succeed.',
  },
  {
    name: 'C. pg_get_serial_sequence (returns regclass)',
    sql: `SELECT pg_get_serial_sequence('"public"."tenants"', 'id')::regclass AS seq_name`,
    note: 'drizzle-kit selects the sequence name as regclass when reading serial columns.',
  },
  {
    name: 'D. pg_get_serial_sequence cast to text (the fix)',
    sql: `SELECT pg_get_serial_sequence('"public"."tenants"', 'id')::regclass::text AS seq_name`,
    note: 'Same expression with ::text. Expected to succeed.',
  },
  {
    name: 'E. attidentity / attgenerated (Postgres type "char")',
    sql: `SELECT a.attidentity AS identity_type, a.attgenerated AS generated_type
          FROM pg_attribute a WHERE a.attrelid = '"public"."tenants"'::regclass AND a.attnum > 0 LIMIT 1`,
    note: 'Both columns are "char"; drizzle-kit selects them uncast.',
  },
  {
    name: 'F. positional parameter $1',
    sql: `SELECT $1::text AS echo`,
    note: 'The Data API binds named parameters only; drizzle-kit\'s proxy passes $N through unchanged.',
  },
];

let failures = 0;
for (const probe of probes) {
  console.log(`\n### ${probe.name}`);
  console.log(probe.note);
  try {
    const result = await run(probe.sql);
    const rows = result.records?.length ?? 0;
    console.log(`RESULT: succeeded (${rows} row${rows === 1 ? '' : 's'})`);
  } catch (error) {
    failures++;
    const err = error as { name?: string; message?: string };
    console.log(`RESULT: FAILED  ${err.name}: ${redact(err.message ?? String(error))}`);
  }
}

console.log(`\n${failures} of ${probes.length} probes failed.`);
