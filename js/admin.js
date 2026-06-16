import { supabase, getCurrentUser } from './supabase-client.js';
import { showToast } from './utils.js';
import { CONFIG } from './config.js';

let currentUser = null;

// ============================================
// INITIALIZATION
// ============================================

async function init() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
        window.location.href = 'login.html';
        return;
    }
    
    currentUser = await getCurrentUser();
    
    if (!currentUser || currentUser.role !== 'admin') {
        window.location.href = 'chat.html';
        return;
    }
    
    await loadStats();
    await loadUsers();
    await loadArchiveLog();
    
    setupEventListeners();
}

// ============================================
// STATS
// ============================================

async function loadStats() {
    // Total users
    const { count: usersCount } = await supabase
        .from('profiles')
        .select('*', { count: 'exact', head: true });
    
    document.getElementById('totalUsers').textContent = usersCount || 0;
    
    // Total messages
    const { count: messagesCount } = await supabase
        .from('messages')
        .select('*', { count: 'exact', head: true });
    
    document.getElementById('totalMessages').textContent = messagesCount || 0;
    
    // Active stories
    const { count: storiesCount } = await supabase
        .from('stories')
        .select('*', { count: 'exact', head: true })
        .gt('expires_at', new Date().toISOString());
    
    document.getElementById('activeStories').textContent = storiesCount || 0;
}

// ============================================
// USER MANAGEMENT
// ============================================

async function loadUsers() {
    const { data: users } = await supabase
        .from('profiles')
        .select('*')
        .order('created_at', { ascending: false });
    
    const tbody = document.getElementById('usersTableBody');
    tbody.innerHTML = '';
    
    users.forEach(user => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${user.display_name}</td>
            <td>${user.email}</td>
            <td><span class="role-badge role-${user.role}">${user.role}</span></td>
            <td><span class="status-${user.status}">${user.status}</span></td>
            <td>
                <button class="btn btn-secondary btn-sm" onclick="editUser('${user.id}')">Edit</button>
                ${user.id !== currentUser.id ? `<button class="btn btn-danger btn-sm" onclick="deleteUser('${user.id}')">Delete</button>` : ''}
            </td>
        `;
        tbody.appendChild(tr);
    });
}

async function createUser(email, displayName, password, role) {
    try {
        // Create auth user using Supabase Admin API
        // Note: This requires the service role key
        // For security, this should be done through a server endpoint
        // For this demo, we'll use the admin API directly
        
        const { data, error } = await supabase.auth.admin.createUser({
            email,
            password,
            email_confirm: true,
            user_metadata: {
                display_name: displayName
            }
        });
        
        if (error) throw error;
        
        // Create profile
        const { error: profileError } = await supabase
            .from('profiles')
            .insert({
                id: data.user.id,
                email,
                display_name: displayName,
                role
            });
        
        if (profileError) throw profileError;
        
        showToast('User created successfully', 'success');
        await loadUsers();
        await loadStats();
        
        return true;
        
    } catch (error) {
        showToast(error.message, 'error');
        return false;
    }
}

// Note: For production, create user should use Supabase service_role key
// This requires setting up a server endpoint or Edge Function
// For GitHub Pages limitation, you'd need to use Supabase Edge Functions

window.deleteUser = async function(userId) {
    if (!confirm('Are you sure you want to delete this user?')) return;
    
    try {
        const { error } = await supabase.auth.admin.deleteUser(userId);
        if (error) throw error;
        
        showToast('User deleted successfully', 'success');
        await loadUsers();
        await loadStats();
        
    } catch (error) {
        showToast(error.message, 'error');
    }
};

window.editUser = async function(userId) {
    showToast('Edit functionality coming soon', 'info');
};

// ============================================
// ARCHIVE
// ============================================

async function runArchive() {
    const days = parseInt(document.getElementById('archiveDays').value);
    const statusDiv = document.getElementById('archiveStatus');
    
    statusDiv.innerHTML = '<p>⏳ Archiving in progress...</p>';
    
    try {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - days);
        
        // Get old messages
        const { data: oldMessages } = await supabase
            .from('messages')
            .select('*')
            .lt('created_at', cutoffDate.toISOString())
            .eq('archived', false);
        
        if (!oldMessages || oldMessages.length === 0) {
            statusDiv.innerHTML = '<p>✅ No messages to archive</p>';
            return;
        }
        
        statusDiv.innerHTML = `<p>⏳ Found ${oldMessages.length} messages to archive...</p>`;
        
        // Send to Google Apps Script
        const response = await fetch(CONFIG.ARCHIVE_ENDPOINT, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                secret: CONFIG.ARCHIVE_SECRET,
                table: 'messages',
                data: oldMessages
            })
        });
        
        const result = await response.json();
        
        if (result.success) {
            // Mark messages as archived
            const messageIds = oldMessages.map(m => m.id);
            
            const { error } = await supabase
                .from('messages')
                .update({ archived: true })
                .in('id', messageIds);
            
            if (error) throw error;
            
            // Log archive
            await supabase
                .from('archive_log')
                .insert({
                    table_name: 'messages',
                    records_count: oldMessages.length,
                    status: 'success'
                });
            
            statusDiv.innerHTML = `<p class="success">✅ Successfully archived ${oldMessages.length} messages</p>`;
            await loadArchiveLog();
            await loadStats();
            
        } else {
            throw new Error(result.error || 'Archive failed');
        }
        
    } catch (error) {
        statusDiv.innerHTML = `<p class="error">❌ Archive failed: ${error.message}</p>`;
        
        await supabase
            .from('archive_log')
            .insert({
                table_name: 'messages',
                records_count: 0,
                status: 'failed',
                error_message: error.message
            });
    }
}

async function loadArchiveLog() {
    const { data: logs } = await supabase
        .from('archive_log')
        .select('*')
        .order('archived_at', { ascending: false })
        .limit(10);
    
    const logDiv = document.getElementById('archiveLog');
    logDiv.innerHTML = '';
    
    if (!logs || logs.length === 0) {
        logDiv.innerHTML = '<p style="color:var(--text-muted)">No archive history</p>';
        return;
    }
    
    logs.forEach(log => {
        const entry = document.createElement('div');
        entry.className = `archive-entry ${log.status}`;
        entry.innerHTML = `
            <strong>${log.table_name}</strong> - ${log.records_count} records
            <br>
            <small>${new Date(log.archived_at).toLocaleString()}</small>
            ${log.error_message ? `<br><small class="error">${log.error_message}</small>` : ''}
        `;
        logDiv.appendChild(entry);
    });
}

// ============================================
// EVENT LISTENERS
// ============================================

function setupEventListeners() {
    // Logout
    document.getElementById('logoutBtn').addEventListener('click', async () => {
        await supabase.auth.signOut();
        window.location.href = 'login.html';
    });
    
    // Create user form
    document.getElementById('createUserForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const email = document.getElementById('newUserEmail').value;
        const displayName = document.getElementById('newUserName').value;
        const password = document.getElementById('newUserPassword').value;
        const role = document.getElementById('newUserRole').value;
        
        const success = await createUser(email, displayName, password, role);
        
        if (success) {
            e.target.reset();
        }
    });
    
    // Archive
    document.getElementById('triggerArchiveBtn').addEventListener('click', runArchive);
}

// ============================================
// INIT
// ============================================

init();
