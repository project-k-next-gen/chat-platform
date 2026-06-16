import { supabase, getCurrentUser } from './supabase-client.js';
import { formatTime, getInitials, isOnline, escapeHtml, showToast } from './utils.js';
import { CONFIG } from './config.js';

let currentUser = null;
let currentConversation = null;
let messagesSubscription = null;

// ============================================
// INITIALIZATION
// ============================================

async function init() {
    // Check authentication
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
        window.location.href = 'login.html';
        return;
    }
    
    currentUser = await getCurrentUser();
    if (!currentUser) {
        await supabase.auth.signOut();
        window.location.href = 'login.html';
        return;
    }
    
    // Show admin tab if admin
    if (currentUser.role === 'admin') {
        document.querySelector('[data-tab="admin"]').style.display = 'block';
    }
    
    // Set user name
    document.getElementById('currentUserName').textContent = currentUser.display_name;
    
    // Load conversations
    await loadConversations();
    
    // Setup event listeners
    setupEventListeners();
    
    // Subscribe to new messages
    subscribeToMessages();
}

// ============================================
// CONVERSATIONS
// ============================================

async function loadConversations() {
    const { data: conversations } = await supabase
        .from('conversation_members')
        .select(`
            conversation_id,
            conversations (
                id,
                name,
                type,
                updated_at
            )
        `)
        .eq('user_id', currentUser.id);
    
    const conversationsList = document.getElementById('conversationsList');
    conversationsList.innerHTML = '';
    
    if (!conversations || conversations.length === 0) {
        conversationsList.innerHTML = '<p style="padding:20px;text-align:center;color:var(--text-muted)">No conversations yet</p>';
        return;
    }
    
    for (const conv of conversations) {
        const conversation = conv.conversations;
        
        // Get conversation display info
        let displayName = conversation.name || 'Chat';
        let avatar = '💬';
        
        if (conversation.type === 'direct') {
            // Get other user
            const { data: members } = await supabase
                .from('conversation_members')
                .select('user_id, profiles(display_name, avatar_url, last_seen)')
                .eq('conversation_id', conversation.id)
                .neq('user_id', currentUser.id)
                .single();
            
            if (members) {
                displayName = members.profiles.display_name;
                avatar = getInitials(displayName);
            }
        }
        
        // Get last message
        const { data: lastMessage } = await supabase
            .from('messages')
            .select('content, created_at')
            .eq('conversation_id', conversation.id)
            .order('created_at', { ascending: false })
            .limit(1)
            .single();
        
        const item = document.createElement('div');
        item.className = 'conversation-item';
        item.dataset.conversationId = conversation.id;
        item.innerHTML = `
            <div class="conversation-avatar">${avatar}</div>
            <div class="conversation-info">
                <div class="conversation-name">${escapeHtml(displayName)}</div>
                <div class="conversation-preview">
                    ${lastMessage ? escapeHtml(lastMessage.content || '📷 Image') : 'No messages yet'}
                </div>
            </div>
        `;
        
        item.addEventListener('click', () => openConversation(conversation.id));
        conversationsList.appendChild(item);
    }
}

async function openConversation(conversationId) {
    currentConversation = conversationId;
    
    // Update UI
    document.querySelectorAll('.conversation-item').forEach(item => {
        item.classList.remove('active');
    });
    document.querySelector(`[data-conversation-id="${conversationId}"]`)?.classList.add('active');
    
    document.getElementById('noChatSelected').style.display = 'none';
    document.getElementById('chatContainer').style.display = 'flex';
    
    // Load conversation details
    const { data: conversation } = await supabase
        .from('conversations')
        .select('*')
        .eq('id', conversationId)
        .single();
    
    let title = conversation.name || 'Chat';
    let status = '';
    
    if (conversation.type === 'direct') {
        const { data: member } = await supabase
            .from('conversation_members')
            .select('user_id, profiles(display_name, last_seen)')
            .eq('conversation_id', conversationId)
            .neq('user_id', currentUser.id)
            .single();
        
        if (member) {
            title = member.profiles.display_name;
            status = isOnline(member.profiles.last_seen) ? 
                '<span class="status-dot online"></span>Online' : 
                '<span class="status-dot offline"></span>Offline';
        }
    }
    
    document.getElementById('chatTitle').textContent = title;
    document.getElementById('chatStatus').innerHTML = status;
    
    // Load messages
    await loadMessages(conversationId);
    
    // Subscribe to realtime updates for this conversation
    subscribeToConversation(conversationId);
}

async function loadMessages(conversationId) {
    const { data: messages } = await supabase
        .from('messages')
        .select(`
            *,
            profiles:sender_id (display_name, avatar_url)
        `)
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true });
    
    const messagesArea = document.getElementById('messagesArea');
    messagesArea.innerHTML = '';
    
    if (!messages || messages.length === 0) {
        messagesArea.innerHTML = '<p style="text-align:center;color:var(--text-muted);padding:20px;">No messages yet. Start the conversation!</p>';
        return;
    }
    
    messages.forEach(message => {
        appendMessage(message);
    });
    
    // Scroll to bottom
    messagesArea.scrollTop = messagesArea.scrollHeight;
}

function appendMessage(message) {
    const messagesArea = document.getElementById('messagesArea');
    const isOwn = message.sender_id === currentUser.id;
    
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${isOwn ? 'own' : ''}`;
    
    const avatar = getInitials(message.profiles.display_name);
    
    let content = '';
    if (message.media_url) {
        content = `<img src="${message.media_url}" class="message-image" alt="Shared image">`;
    }
    if (message.content) {
        content += `<div class="message-text">${escapeHtml(message.content)}</div>`;
    }
    
    messageDiv.innerHTML = `
        <div class="message-avatar">${avatar}</div>
        <div class="message-content">
            ${!isOwn ? `<div class="message-sender">${escapeHtml(message.profiles.display_name)}</div>` : ''}
            ${content}
            <div class="message-time">${formatTime(message.created_at)}</div>
        </div>
    `;
    
    messagesArea.appendChild(messageDiv);
    messagesArea.scrollTop = messagesArea.scrollHeight;
}

// ============================================
// SEND MESSAGE
// ============================================

async function sendMessage(content, mediaUrl = null) {
    if (!currentConversation) return;
    if (!content && !mediaUrl) return;
    
    try {
        const { error } = await supabase
            .from('messages')
            .insert({
                conversation_id: currentConversation,
                sender_id: currentUser.id,
                content: content || null,
                media_url: mediaUrl,
                media_type: mediaUrl ? 'image' : null
            });
        
        if (error) throw error;
        
        // Clear input
        document.getElementById('messageInput').value = '';
        
    } catch (error) {
        showToast('Failed to send message', 'error');
        console.error(error);
    }
}

// ============================================
// REALTIME SUBSCRIPTIONS
// ============================================

function subscribeToMessages() {
    supabase
        .channel('messages')
        .on('postgres_changes', {
            event: 'INSERT',
            schema: 'public',
            table: 'messages'
        }, async (payload) => {
            // Check if message is for current conversation
            if (payload.new.conversation_id === currentConversation) {
                // Fetch full message with profile
                const { data: message } = await supabase
                    .from('messages')
                    .select(`
                        *,
                        profiles:sender_id (display_name, avatar_url)
                    `)
                    .eq('id', payload.new.id)
                    .single();
                
                if (message) {
                    appendMessage(message);
                }
            } else {
                // Reload conversations to show new message indicator
                loadConversations();
            }
        })
        .subscribe();
}

function subscribeToConversation(conversationId) {
    // Unsubscribe from previous
    if (messagesSubscription) {
        supabase.removeChannel(messagesSubscription);
    }
    
    messagesSubscription = supabase
        .channel(`conversation:${conversationId}`)
        .on('postgres_changes', {
            event: '*',
            schema: 'public',
            table: 'messages',
            filter: `conversation_id=eq.${conversationId}`
        }, () => {
            loadMessages(conversationId);
        })
        .subscribe();
}

// ============================================
// NEW CHAT
// ============================================

async function showNewChatModal() {
    const { data: users } = await supabase
        .from('profiles')
        .select('*')
        .neq('id', currentUser.id)
        .order('display_name');
    
    const usersList = document.getElementById('usersList');
    usersList.innerHTML = '';
    
    users.forEach(user => {
        const userItem = document.createElement('div');
        userItem.className = 'user-item';
        userItem.innerHTML = `
            <div class="conversation-avatar">${getInitials(user.display_name)}</div>
            <div>
                <div>${escapeHtml(user.display_name)}</div>
                <div style="font-size:12px;color:var(--text-muted)">${escapeHtml(user.email)}</div>
            </div>
        `;
        
        userItem.addEventListener('click', async () => {
            await createDirectConversation(user.id);
            closeModal();
        });
        
        usersList.appendChild(userItem);
    });
    
    document.getElementById('newChatModal').classList.add('active');
}

async function createDirectConversation(otherUserId) {
    try {
        const { data, error } = await supabase
            .rpc('get_or_create_direct_conversation', {
                other_user_id: otherUserId
            });
        
        if (error) throw error;
        
        await loadConversations();
        await openConversation(data);
        
    } catch (error) {
        showToast('Failed to create conversation', 'error');
        console.error(error);
    }
}

window.closeModal = function() {
    document.getElementById('newChatModal').classList.remove('active');
};

// ============================================
// IMAGE UPLOAD
// ============================================

async function handleImageUpload(file) {
    if (!file) return;
    
    if (file.size > CONFIG.MAX_FILE_SIZE) {
        showToast('File too large. Maximum 5MB allowed.', 'error');
        return;
    }
    
    if (!file.type.startsWith('image/')) {
        showToast('Only images are allowed', 'error');
        return;
    }
    
    try {
        const fileName = `${currentUser.id}/${Date.now()}_${file.name}`;
        
        const { data, error } = await supabase.storage
            .from('media')
            .upload(fileName, file);
        
        if (error) throw error;
        
        const { data: { publicUrl } } = supabase.storage
            .from('media')
            .getPublicUrl(data.path);
        
        await sendMessage(null, publicUrl);
        
    } catch (error) {
        showToast('Failed to upload image', 'error');
        console.error(error);
    }
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
    
    // Send message
    document.getElementById('sendBtn').addEventListener('click', () => {
        const content = document.getElementById('messageInput').value.trim();
        if (content) {
            sendMessage(content);
        }
    });
    
    document.getElementById('messageInput').addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            const content = e.target.value.trim();
            if (content) {
                sendMessage(content);
            }
        }
    });
    
    // Image upload
    document.getElementById('uploadImageBtn').addEventListener('click', () => {
        document.getElementById('imageInput').click();
    });
    
    document.getElementById('imageInput').addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            handleImageUpload(file);
        }
        e.target.value = '';
    });
    
    // New chat
    document.getElementById('newChatBtn').addEventListener('click', showNewChatModal);
    
    // Tabs
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const tab = btn.dataset.tab;
            if (tab === 'admin') {
                window.location.href = 'admin.html';
            } else if (tab === 'stories') {
                window.location.href = 'stories.html';
            }
        });
    });
}

// ============================================
// INIT
// ============================================

init();
