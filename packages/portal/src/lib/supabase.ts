import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://nwzmjtlphpmwaawyrgax.supabase.co';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im53em1qdGxwaHBtd2Fhd3lyZ2F4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQwMTM5NjUsImV4cCI6MjA4OTU4OTk2NX0.B8KeRS1aATbTNDA72HqQahgg3gphnbHoe-Vg7qGW3Yo';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
