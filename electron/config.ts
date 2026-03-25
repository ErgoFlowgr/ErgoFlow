/**
 * Baked-in config for the Electron main process.
 * These values are the same for ALL users — one shared Supabase backend.
 * The anon key is safe to embed (RLS ensures users only see their own data).
 * In dev, falls back to .env via process.env.
 */

export const SUPABASE_URL =
  process.env['VITE_SUPABASE_URL'] ??
  'https://ftorwjwcxcgbwwonbcwq.supabase.co'

export const SUPABASE_ANON_KEY =
  process.env['VITE_SUPABASE_ANON_KEY'] ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ0b3J3andjeGNnYnd3b25iY3dxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM4NDAwNDgsImV4cCI6MjA4OTQxNjA0OH0.3PhQcZYnisEmANFKEJPfbcg4_FIhqhQnH2Mz-hVx7U8'
