import { randomInt } from "node:crypto";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

export function generatePublicId(prefix: string): string {
  let id = prefix;
  for (let i = 0; i < 24; i++) {
    id += ALPHABET[randomInt(ALPHABET.length)];
  }
  return id;
}
