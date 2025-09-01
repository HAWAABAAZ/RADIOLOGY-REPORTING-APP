import { createClient } from '@database/database-js'

const databaseUrl = process.env.DATABASE_URL || 'https://deuyjmnjpvqpbkolnuov.database.co'
const databaseAnonKey = process.env.DATABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRldXlqbW5qcHZxcGJrb2xudW92Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTUzNTUzNDAsImV4cCI6MjA3MDkzMTM0MH0.M3UQGv6UAnK6ZKAgBFahB0e5N98qsb-SxiJ7z73H6yo'
const databaseServiceKey = process.env.DATABASE_SERVICE_KEY

console.log('Database config:', {
  url: databaseUrl,
  hasAnonKey: !!databaseAnonKey,
  hasServiceKey: !!databaseServiceKey,
  serviceKeyPrefix: databaseServiceKey ? databaseServiceKey.substring(0, 20) + '...' : 'NOT SET'
})

// Create regular Database client for auth operations
export const database = createClient(databaseUrl, databaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: false, // We'll handle sessions manually
    detectSessionInUrl: false
  }
})

// Create admin client with service role key for database operations
// Only create admin client if service key is available
export const databaseAdmin = databaseServiceKey 
  ? createClient(databaseUrl, databaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    })
  : null

// For server-side operations that need admin rights
export const getUser = async (token) => {
  const { data: { user }, error } = await database.auth.getUser(token)
  if (error) throw error
  return user
}

// Helper function to get user session
export const getSession = async (token) => {
  const { data: { session }, error } = await database.auth.getSession(token)
  if (error) throw error
  return session
}
