import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(8080),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  REDIS_URL: z.string().min(1, "REDIS_URL is required"),

  STRIPE_SECRET_KEY: z.string().min(1, "STRIPE_SECRET_KEY is required (a sk_test_... key)"),
  STRIPE_API_BASE: z.string().default("https://api.stripe.com"),
  ACQUIRER_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),

  PLATFORM_FEE_BPS: z.coerce.number().int().min(0).max(10000).default(290),
  JOB_POLL_MS: z.coerce.number().int().positive().default(2000),
});

export const env = EnvSchema.parse(process.env);
