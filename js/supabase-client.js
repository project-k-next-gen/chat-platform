import { CONFIG } from './config.js';

// Initialize Supabase client
export const supabase = window.supabase.createClient(
    CONFIG.SUPABASE_URL,
    CONFIG.SUPABASE_ANON_KEY
);

// Get current session
export async function getCurrentUser() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return null;
    
    const { data: profile } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', session.user.id)
        .single();
    
    return profile;
}

// Update user status
export async function updateUserStatus(status = 'online') {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    
    await supabase
        .from('profiles')
        .update({ 
            status,
            last_seen: new Date().toISOString()
        })
        .eq('id', session.user.id);
}

// Listen for auth changes
supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_IN') {
        updateUserStatus('online');
    } else if (event === 'SIGNED_OUT') {
        updateUserStatus('offline');
    }
});

// Update last seen periodically
if (typeof window !== 'undefined') {
    setInterval(() => {
        supabase.auth.getSession().then(({ data: { session } }) => {
            if (session) {
                updateUserStatus('online');
            }
        });
    }, 60000); // Every minute
}
