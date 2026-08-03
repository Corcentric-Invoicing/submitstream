import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://xlgnmmjklzbyzqxwnzlv.supabase.co';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhsZ25tbWprbHpieXpxeHduemx2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI1NjkyNDIsImV4cCI6MjA5ODE0NTI0Mn0.WE9Y9m-oX4plXLOizAE9VVgazO6zLUAKsFReIdEfl4I';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
