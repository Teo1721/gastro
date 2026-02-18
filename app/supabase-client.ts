import { createBrowserClient } from '@supabase/ssr'

export const createClient = () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

  // If variables are missing, don't let the SDK crash the build
  if (!url.startsWith('http')) {
    return {} as any
  }

  return createBrowserClient(url, key)
}
