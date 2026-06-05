import { createApp } from "./app";
import { pool } from "./db/pool";
import { env } from "./config/env";
import { redisClient } from "./db/redis";
import { startJobs } from "./jobs";

const app = createApp(pool, redisClient);
let server: ReturnType<typeof app.listen>;
let stopJobs: () => void = () => {};

async function main() {
  await redisClient.connect();
  stopJobs = startJobs(pool);
  server = app.listen(env.PORT, () => {
    console.log(`bifrost-api listening on :${env.PORT}`);
  });
}

function shutdown(signal: string) {
  console.log(`${signal} received, shutting down`);
  stopJobs();
  server.close(async (err) => {
    if (err) {
      console.error(err);
      process.exitCode = 1;
    }
    await pool.end();
    await redisClient.quit();
    process.exit();
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

main().catch((err) => {
  console.error("failed to start", err);
  process.exit(1);
});
