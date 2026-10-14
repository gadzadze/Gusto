import "server-only";
import { createClient } from "@supabase/supabase-js";
import { serverEnv, serviceRoleKey } from "@/server/env";

export const PRODUCT_IMAGES_BUCKET = "product-images";

/** Where processed images go. Supabase Storage in the app; a fake in tests. */
export interface ImageStorage {
  put(path: string, body: Buffer, contentType: string): Promise<void>;
  remove(paths: string[]): Promise<void>;
}

// Uses the service-role key: the bucket has no write policies, so only the
// server can write. Never import this from client code.
export function supabaseImageStorage(): ImageStorage {
  const client = createClient(serverEnv().NEXT_PUBLIC_SUPABASE_URL, serviceRoleKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const bucket = client.storage.from(PRODUCT_IMAGES_BUCKET);
  return {
    async put(path, body, contentType) {
      const { error } = await bucket.upload(path, body, {
        contentType,
        upsert: false,
        cacheControl: "31536000",
      });
      if (error) throw new Error(`storage upload failed: ${error.message}`);
    },
    async remove(paths) {
      if (paths.length === 0) return;
      const { error } = await bucket.remove(paths);
      if (error) throw new Error(`storage remove failed: ${error.message}`);
    },
  };
}
