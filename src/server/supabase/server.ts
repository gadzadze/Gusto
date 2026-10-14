import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { serverEnv } from "@/server/env";

/** Supabase client bound to this request's auth cookies. Auth only — no data access. */
export async function createSupabaseServerClient() {
  // Request time only. The client reads the clock while loading the session,
  // which Next.js forbids during any prerender (including runtime prefetch
  // prerenders, where cookies are available). This must come before anything
  // touches runtime config, so build-time prerendering stops here.
  await connection();
  const cookieStore = await cookies();
  const env = serverEnv();
  return createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Components can't write cookies. The proxy refreshes the
          // session on every request, so this is safe to ignore here.
        }
      },
    },
  });
}
