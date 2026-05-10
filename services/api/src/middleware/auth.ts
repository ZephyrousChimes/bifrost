import { RequestHandler } from "express";
import { ApiKeyRepository } from "../merchant/api-key.repository";
import { sha256Hex } from "../lib/hash";
import { errorEnvelope } from "../lib/errorEnvelope";

const SCHEME = "bearer ";

export function apiKeyAuth(apiKeyRepository: ApiKeyRepository): RequestHandler {
  return async (req, res, next) => {
    if (!req.path.startsWith("/v1/")) {
      return next();
    }

    if (req.method === "POST" && req.path === "/v1/merchants") {
      return next();
    }

    const authHeader = req.header("authorization");
    if (!authHeader || !authHeader.toLowerCase().startsWith(SCHEME)) {
      return unauthorized(res, "api_key_missing", "No API key provided.");
    }

    const token = authHeader.slice(SCHEME.length).trim();
    if (!token) {
      return unauthorized(res, "api_key_missing", "No API key provided.");
    }

    const apiKey = await apiKeyRepository.findActiveByKeyHash(sha256Hex(token));
    if (!apiKey) {
      return unauthorized(res, "api_key_invalid", "No such API key.");
    }

    req.merchantId = apiKey.merchant_id;
    next();
  };
}

function unauthorized(res: Parameters<RequestHandler>[1], code: string, message: string) {
  res.status(401).json(errorEnvelope("authentication_error", code, message));
}
