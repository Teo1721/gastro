import { createBrowserClient } from '@supabase/ssr'

export const createClient = () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // If these are missing during the Vercel build, return a dummy object
  // to prevent the .startsWith() crash.
  if (!url || !key) {
    return {} as any; 
  }

  return createBrowserClient(url, key);
}
