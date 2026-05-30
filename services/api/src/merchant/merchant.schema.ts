import { z } from "zod";

export const CreateMerchantSchema = z.object({
  name: z.string().trim().min(1),
  email: z.string().trim().min(1).email(),
  webhook_url: z.string().url().optional(),
});
export type CreateMerchantInput = z.infer<typeof CreateMerchantSchema>;

export const CreateApiKeySchema = z
  .object({
    livemode: z.boolean().optional(),
  })
  .optional();
export type CreateApiKeyInput = z.infer<typeof CreateApiKeySchema>;
