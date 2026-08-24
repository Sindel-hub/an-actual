import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export const SUPABASE_URL = "https://svgfxatigtjdrwzibjbu.supabase.co";
export const SUPABASE_ANON_KEY = "sb_publishable_tGz7URzV92fr3M8RSRbHcg_BOy9Oqxl";
export const SUPABASE_PUBLIC_BUCKET = "usc-public-media";
export const SUPABASE_PRIVATE_BUCKET = "usc-private-documents";
// Compatibility alias for old media-only pages. New code must use signed upload tickets.
export const SUPABASE_BUCKET = SUPABASE_PUBLIC_BUCKET;
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
