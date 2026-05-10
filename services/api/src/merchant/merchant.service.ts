import { Pool } from "pg";
import { withTransaction } from "../db/transaction";
import { Queryable } from "../db/types";
import { generatePublicId } from "../lib/publicId";
import { sha256Hex } from "../lib/hash";
import { ResourceNotFoundError } from "../lib/errors";
import { MerchantRepository, MerchantRow } from "./merchant.repository";
import { ApiKeyRepository, ApiKeyRow } from "./api-key.repository";

export interface MintedKey {
  apiKey: ApiKeyRow;
  secretKey: string;
}

export interface Registration {
  merchant: MerchantRow;
  apiKey: ApiKeyRow;
  secretKey: string;
}

export interface MerchantService {
  register(name: string, email: string): Promise<Registration>;
  mintApiKey(merchantId: number, livemode: boolean): Promise<MintedKey>;
  revokeApiKey(merchantId: number, keyPublicId: string): Promise<ApiKeyRow>;
  get(merchantId: number): Promise<MerchantRow>;
  setWebhook(merchantId: number, url: string | null): Promise<MerchantRow>;
}

export function createMerchantService(
  pool: Pool,
  merchantRepository: MerchantRepository,
  apiKeyRepository: ApiKeyRepository,
): MerchantService {
  async function mintApiKey(merchantId: number, livemode: boolean, executor?: Queryable): Promise<MintedKey> {
    const secretKey = generatePublicId(livemode ? "sk_live_" : "sk_test_");
    const apiKey = await apiKeyRepository.insert(
      generatePublicId("key_"),
      merchantId,
      sha256Hex(secretKey),
      secretKey.slice(0, 16),
      livemode,
      executor,
    );
    return { apiKey, secretKey };
  }

  return {
    async register(name, email) {
      return withTransaction(pool, async (client) => {
        const merchant = await merchantRepository.insert(generatePublicId("mer_"), name, email, client);
        const minted = await mintApiKey(merchant.id, false, client);
        return { merchant, apiKey: minted.apiKey, secretKey: minted.secretKey };
      });
    },

    mintApiKey: (merchantId, livemode) => mintApiKey(merchantId, livemode),

    async revokeApiKey(merchantId, keyPublicId) {
      const apiKey = await apiKeyRepository.findByPublicIdAndMerchantId(keyPublicId, merchantId);
      if (!apiKey) {
        throw new ResourceNotFoundError(`No such API key: ${keyPublicId}`);
      }
      return apiKeyRepository.revoke(apiKey.id);
    },

    async get(merchantId) {
      const merchant = await merchantRepository.findById(merchantId);
      if (!merchant) {
        throw new ResourceNotFoundError("No such merchant");
      }
      return merchant;
    },

    setWebhook(merchantId, url) {
      return merchantRepository.setWebhook(merchantId, url);
    },
  };
}
