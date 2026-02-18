import { createBrowserClient } from '@supabase/ssr'

export const createClient = () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  // Return a dummy object if variables are missing during build
  if (!url || !key) {
    return {} as any 
  }

  return createBrowserClient(url, key)
}
