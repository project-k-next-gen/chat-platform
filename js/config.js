// ============================================
// CONFIGURATION
// ============================================

export const CONFIG = {
    // Supabase Configuration
    SUPABASE_URL: 'YOUR_SUPABASE_URL', // e.g., https://xxxxx.supabase.co
    SUPABASE_ANON_KEY: 'YOUR_SUPABASE_ANON_KEY',
    
    // Google Apps Script Web App URL for Archive
    ARCHIVE_ENDPOINT: 'YOUR_GOOGLE_APPS_SCRIPT_WEB_APP_URL',
    
    // Archive Secret Token (must match in Apps Script)
    ARCHIVE_SECRET: 'YOUR_SECRET_TOKEN_HERE', // Change this to a random string
    
    // Archive settings
    ARCHIVE_DAYS: 60, // Messages older than this will be archived
    
    // Media settings
    MAX_FILE_SIZE: 5 * 1024 * 1024, // 5MB
    
    // Stories expiry
    STORIES_HOURS: 24
};
