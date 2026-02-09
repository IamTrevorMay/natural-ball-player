import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://cjilkqzifyhssbsiqgfu.supabase.co'
const supabaseAnonKey = 'sb_publishable_xJnJl8nDLe1O6CQu0EnwwQ_vBZ6_fGg'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
