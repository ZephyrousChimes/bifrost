import { Pool, types } from "pg";
import { env } from "../config/env";

types.setTypeParser(20, (value) => parseInt(value, 10));

export const pool = new Pool({ connectionString: env.DATABASE_URL });
