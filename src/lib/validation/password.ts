import { z } from "zod";

// Chosen by the person themselves (never by an admin). Messages are i18n keys
// under `password.errors.*`. 72 is bcrypt's input limit, which Supabase uses.
export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 72;

export const newPasswordSchema = z
  .object({
    password: z.string().min(PASSWORD_MIN, "too_short").max(PASSWORD_MAX, "too_long"),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { path: ["confirm"], message: "mismatch" });
