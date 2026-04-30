import type { Config } from "drizzle-kit";

const url = process.env.DATABASE_URL ?? "";

export default {
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url },
  casing: "snake_case",
  verbose: true,
  strict: true,
} satisfies Config;
