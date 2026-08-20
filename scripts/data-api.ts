import { ExecuteStatementCommand, RDSDataClient } from '@aws-sdk/client-rds-data';

/** Connection details come from the environment only; nothing is committed. */
export function config() {
  const database = process.env.DRIZZLE_REPRO_DATABASE;
  const secretArn = process.env.DRIZZLE_REPRO_SECRET_ARN;
  const resourceArn = process.env.DRIZZLE_REPRO_CLUSTER_ARN;
  if (!database || !secretArn || !resourceArn) {
    throw new Error(
      'Missing connection details. Copy .env.example to .env and fill in DRIZZLE_REPRO_DATABASE, DRIZZLE_REPRO_SECRET_ARN, and DRIZZLE_REPRO_CLUSTER_ARN.',
    );
  }
  return { database, secretArn, resourceArn };
}

export const client = new RDSDataClient({ region: process.env.AWS_REGION ?? 'us-east-1' });

/** Run one statement over the Data API. */
export async function run(sql: string) {
  const { database, secretArn, resourceArn } = config();
  return client.send(
    new ExecuteStatementCommand({ sql, database, secretArn, resourceArn, includeResultMetadata: true }),
  );
}

/**
 * Redact the two things that identify an AWS account, so captured output can
 * be committed to a public repository.
 */
export function redact(text: string): string {
  return text
    .replace(/arn:aws:[a-z0-9-]+:[a-z0-9-]+:\d{12}:[^\s"']+/g, '<REDACTED_ARN>')
    .replace(/\b\d{12}\b/g, '<REDACTED_ACCOUNT_ID>');
}
