# drizzle-kit + RDS Data API reproduction

Minimal reproduction of `drizzle-kit` introspection failures against **Aurora Serverless v2 (PostgreSQL) over the RDS Data API**.

Related upstream issue: [drizzle-team/drizzle-orm#2982](https://github.com/drizzle-team/drizzle-orm/issues/2982).

## Scope, stated precisely

- **`drizzle-orm` is not implicated.** Its `aws-data-api` driver works. This repository carries no orm workaround.
- **`drizzle-kit`'s introspection and proxy layer is what fails**, which affects `pull`, `push`, and `studio`.
- **A direct Postgres connection to the same cluster works.** The Data API is the specific surface that breaks, because it rejects result columns of certain types and binds only named parameters.

## Why an "it works for me" test can miss this

Every failure below comes from a catalog column that **only appears in a result set once the schema contains the feature that produces it**:

| Failure | Requires in the schema |
|---------|------------------------|
| `"CHAR"` from `con.contype` | at least one constraint |
| `"CHAR"` from `a.attidentity` / `a.attgenerated` | any column (read during column introspection) |
| `regclass` from `pg_get_serial_sequence` | a `serial` / `bigserial` / identity column |

A near-empty schema can therefore introspect cleanly on the same versions that fail here. `src/schema.ts` is built to contain every trigger, and nothing else.

## What reproduces

Measured against `drizzle-orm@0.45.2`, `drizzle-kit@0.31.10`, `@aws-sdk/client-rds-data@3.928.0`, Aurora Serverless v2 PostgreSQL 15.12, with **no patches applied**.

### 1. `drizzle-kit pull` exits 1 and prints nothing

```
[✓] 3  tables fetched
[⣟] 10 columns fetching
...
error: exit status 1
```

No error message, no stack trace, on a TTY or a pipe. The underlying exception is swallowed by the progress renderer, which is what makes this class of bug hard to report: every distinct cause below presents identically as a bare exit 1, so the operator has nothing to paste into an issue.

**This is also fixed in `1.0.0-rc.4`**, which reports the failing query and a stack trace:

```
[✗] Error during introspection:
Failed query: SELECT oid, spcname as "name" FROM pg_catalog.pg_tablespace ORDER BY ...
    at async fromDatabase$3 (.../drizzle-kit/bin.cjs)
```

### 2. The underlying causes, isolated

`bun scripts/probe-data-api-types.ts` issues the same expressions drizzle-kit's introspection selects, one per probe, straight over the Data API. Actual output:

| Probe | Result |
|-------|--------|
| A. `con.contype` (type `"char"`) | **FAILED** `UnsupportedResultException: The result contains the unsupported data type "CHAR".` |
| B. `con.contype::text` | succeeded (1 row) |
| C. `pg_get_serial_sequence(...)::regclass` | **FAILED** `UnsupportedResultException: The result contains the unsupported data type regclass.` |
| D. `pg_get_serial_sequence(...)::regclass::text` | succeeded (1 row) |
| E. `a.attidentity`, `a.attgenerated` (type `"char"`) | **FAILED** `UnsupportedResultException: The result contains the unsupported data type "CHAR".` |
| F. `SELECT $1::text` | **FAILED** `DatabaseErrorException: bind message supplies 0 parameters, but prepared statement requires 1; SQLState: 08P01` |

B and D are the same queries as A and C with a single `::text` appended, so each pair isolates the cause to the result type and demonstrates the fix in the same run.

Probe F is a separate root cause: the Data API accepts only named parameters, so `$N` placeholders forwarded unchanged are never bound.

## Version matrix

`main` holds the failing configuration; the [`rc`](../../tree/rc) branch holds the 1.0 release candidate.

| drizzle-kit | drizzle-orm | `@aws-sdk/client-rds-data` | `drizzle-kit pull` |
|-------------|-------------|----------------------------|--------------------|
| 0.31.10 (latest stable) | 0.45.2 | 3.928.0 | **exit 1, no output** |
| 0.31.10 (latest stable) | 0.45.2 | 3.1114.0 (latest) | **exit 1, no output** |
| 1.0.0-rc.4 | 1.0.0-rc.4 | 3.928.0 | exit 0, correct |
| 1.0.0-rc.4 | 1.0.0-rc.4 | 3.1114.0 (latest) | exit 0, correct |

Because kit prints nothing on failure, the two failing rows cannot be told apart from the CLI; they are both simply "exit 1."

### 1.0.0-rc.4 introspects correctly, not merely without crashing

The schema is built so that three defects would corrupt the output silently rather than raise. The release candidate gets all three right:

- **Composite primary key column order** is preserved: `regions_pkey` is emitted as `[regionCode, countryCode]`, matching `PRIMARY KEY (region_code, country_code)`, not reordered to table or alphabetical order.
- **Multi-column foreign key pairing** is correct: `[homeRegion, homeCountry]` maps to `[regionCode, countryCode]`, and the referencing and referenced orders differ deliberately so a positional mis-pairing would show.
- **Empty array default** is read as `.default([])`.

So for anyone hitting #2982: **the 1.0 release candidate resolves it**, including the `@aws-sdk` pin that the older line forces.

### One defect remains on 1.0.0-rc.4: studio's proxy does not bind parameters

```bash
bun x drizzle-kit studio --port 5599      # in one shell
bun scripts/probe-studio-proxy.ts 5599    # in another
```

```
### CONTROL: no parameters
sql:    select count(*)::text as n from regions
result: [{"n":"0"}]

### TEST: one bound parameter
sql:    select count(*)::text as n from regions where country_code = $1
params: ["US"]
result: {"status":"error","error":"ERROR: bind message supplies 0 parameters,
         but prepared statement \"sqlx_s_35\" requires 1; SQLState: 08P01"}
```

The control isolates the failure to parameter binding: the same query without
parameters succeeds over the same connection.

**Root cause.** `drizzle-orm`'s `AwsPgDialect.escapeParam(num)` returns
`` `:${num + 1}` `` (`aws-data-api/pg/driver.js`), so SQL the ORM *generates*
already carries Data API named placeholders. Studio's client sends **raw** SQL
using Postgres-standard `$N`, and drizzle-kit's `aws-data-api` proxy forwards it
to `session.prepareQuery({ sql, params })` unchanged, so the Data API is asked to
bind named parameters it never received.

A fix belongs in drizzle-kit's `aws-data-api` `query` and `proxy` functions,
translating `$N` to `:N` before `prepareQuery`. The translation must be literal
aware, or it corrupts dollar signs inside string literals, E-strings,
dollar-quoted bodies, line and block comments, quoted identifiers, and bare
identifiers (Postgres permits `$` after an identifier's first character, so
`foo$1` is one identifier, not `foo` followed by `$1`).


## Running it

Requires an Aurora Serverless v2 cluster with the Data API enabled, and AWS credentials with `rds-data` permissions.

```bash
cp .env.example .env      # fill in your own cluster ARN, secret ARN, database
bun install
bun run seed              # creates the catalog with plain DDL, not with drizzle-kit
bun scripts/probe-data-api-types.ts
bun run repro:pull        # exits 1, prints nothing
```

Use an **empty, dedicated database**. `drizzle-kit push` proposes destructive DDL; never point this at data you care about.

The catalog is created with raw DDL over the Data API rather than with drizzle-kit, so the bugs under test (kit's reading of an existing catalog) are isolated from the tool being tested.

## Layout

```
src/schema.ts                     drizzle schema; every element trips a specific failure
scripts/apply-schema.ts           creates the same catalog with plain DDL
scripts/probe-data-api-types.ts   isolates each failure to one expression
scripts/probe-studio-proxy.ts     studio proxy parameter binding, with a control
scripts/data-api.ts               Data API client, config from env, ARN redaction helper
drizzle.config.ts                 aws-data-api driver, credentials from env
```

Connection details live only in `.env`, which is gitignored. Captured output is redacted of ARNs and account ids before being committed.

## License

MIT
