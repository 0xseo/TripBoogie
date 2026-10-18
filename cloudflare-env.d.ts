declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    SUPABASE_URL?: string;
    SUPABASE_PUBLISHABLE_KEY?: string;
    GOOGLE_MAPS_BROWSER_KEY?: string;
    GOOGLE_MAPS_MAP_ID?: string;
  }
}
