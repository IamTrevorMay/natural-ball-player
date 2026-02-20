import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://cjilkqzifyhssbsiqgfu.supabase.co'
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNqaWxrcXppZnloc3Nic2lxZ2Z1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA1NzM0NjMsImV4cCI6MjA4NjE0OTQ2M30.sZH3suieH6Y4PHHb_rSbVS8zPMs-Uy20_rdt51Tfw3c'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
