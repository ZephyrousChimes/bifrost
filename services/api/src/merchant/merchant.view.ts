import { MerchantRow } from "./merchant.repository";
import { ApiKeyRow } from "./api-key.repository";

export function toMerchantView(merchant: MerchantRow) {
  return {
    id: merchant.public_id,
    object: "merchant",
    name: merchant.name,
    email: merchant.email,
    webhook_url: merchant.webhook_url,
    created_at: merchant.created_at,
  };
}

export function toApiKeyView(apiKey: ApiKeyRow, secretKey?: string) {
  return {
    id: apiKey.public_id,
    object: "api_key",
    prefix: apiKey.prefix,
    livemode: apiKey.livemode,
    created_at: apiKey.created_at,
    revoked_at: apiKey.revoked_at,
    ...(secretKey !== undefined ? { secret_key: secretKey } : {}),
  };
}
