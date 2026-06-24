import { z } from "zod";

export const CreateMerchantSchema = z.object({
  name: z.string().trim().min(1),
  email: z.string().trim().min(1).email(),
});
export type CreateMerchantInput = z.infer<typeof CreateMerchantSchema>;

export const CreateApiKeySchema = z
  .object({
    livemode: z.boolean().optional(),
  })
  .optional();
export type CreateApiKeyInput = z.infer<typeof CreateApiKeySchema>;

export const UpdateMerchantSchema = z.object({
  webhook_url: z.string().url().nullable(),
});
export type UpdateMerchantInput = z.infer<typeof UpdateMerchantSchema>;
