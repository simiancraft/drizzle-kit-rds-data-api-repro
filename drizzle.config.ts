import { defineConfig } from 'drizzle-kit';

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set. Copy .env.example to .env and fill it in.`);
  }
  return value;
}

export default defineConfig({
  dialect: 'postgresql',
  driver: 'aws-data-api',
  schema: './src/schema.ts',
  out: './drizzle',
  dbCredentials: {
    database: required('DRIZZLE_REPRO_DATABASE'),
    secretArn: required('DRIZZLE_REPRO_SECRET_ARN'),
    resourceArn: required('DRIZZLE_REPRO_CLUSTER_ARN'),
  },
});
