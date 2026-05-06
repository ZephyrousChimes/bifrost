import { createClient } from "redis";
import { env } from "../config/env";

const MAX_RECONNECT_ATTEMPTS = 5;

const redisClient = createClient({
  url: env.REDIS_URL,
  socket: {
    reconnectStrategy: (retries) => {
      if (retries >= MAX_RECONNECT_ATTEMPTS) {
        return new Error("Redis unreachable after max reconnect attempts");
      }
      return Math.min(retries * 200, 2000);
    },
  },
});

redisClient.on("error", (err) => console.error("Redis Client Error", err));

export { redisClient };