import { supabase, getCurrentUser } from './supabase-client.js';

// Check if already logged in
supabase.auth.getSession().then(({ data: { session } }) => {
    if (session) {
        window.location.href = 'chat.html';
    }
});

// Login form
const loginForm = document.getElementById('loginForm');
if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const email = document.getElementById('email').value;
        const password = document.getElementById('password').value;
        const errorDiv = document.getElementById('error');
        
        errorDiv.textContent = '';
        
        try {
            const { data, error } = await supabase.auth.signInWithPassword({
                email,
                password
            });
            
            if (error) throw error;
            
            // Check if user profile exists
            const profile = await getCurrentUser();
            if (!profile) {
                throw new Error('Profile not found. Contact administrator.');
            }
            
            window.location.href = 'chat.html';
        } catch (error) {
            errorDiv.textContent = error.message;
        }
    });
}

// Logout function (global)
window.logout = async function() {
    await supabase.auth.signOut();
    window.location.href = 'login.html';
};
