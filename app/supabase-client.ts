import { createBrowserClient } from '@supabase/ssr'

export const createClient = () => {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  // If variables are missing during build, return a dummy object to prevent crash
  if (!supabaseUrl || !supabaseAnonKey) {
    return {} as any
  }

  return createBrowserClient(supabaseUrl, supabaseAnonKey)
}
