import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.SUPABASE_URL || 'https://deuyjmnjpvqpbkolnuov.supabase.co'
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRldXlqbW5qcHZxcGJrb2xudW92Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTUzNTUzNDAsImV4cCI6MjA3MDkzMTM0MH0.M3UQGv6UAnK6ZKAgBFahB0e5N98qsb-SxiJ7z73H6yo'
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY

console.log('Supabase config:', {
  url: supabaseUrl,
  hasAnonKey: !!supabaseAnonKey,
  hasServiceKey: !!supabaseServiceKey,
  serviceKeyPrefix: supabaseServiceKey ? supabaseServiceKey.substring(0, 20) + '...' : 'NOT SET'
})

// Create regular Supabase client for auth operations
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: false, // We'll handle sessions manually
    detectSessionInUrl: false
  }
})

// Create admin client with service role key for database operations
// Only create admin client if service key is available
export const supabaseAdmin = supabaseServiceKey 
  ? createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    })
  : null

// For server-side operations that need admin rights
export const getUser = async (token) => {
  const { data: { user }, error } = await supabase.auth.getUser(token)
  if (error) throw error
  return user
}

// Helper function to get user session
export const getSession = async (token) => {
  const { data: { session }, error } = await supabase.auth.getSession(token)
  if (error) throw error
  return session
}
