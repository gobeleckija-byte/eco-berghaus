// Supabase configuration
const supabaseUrl = 'https://xrebwszduxjnuynjownd.supabase.co';
const supabaseKey = 'sb_publishable_TyHq1pSH1Fx1VruiJ_XF2w_GZqEU6RT';
const supabaseClient = window.supabase.createClient(supabaseUrl, supabaseKey);

// Admin credentials
const ADMIN_USERNAME = 'admin';
const ADMIN_PASSWORD = 'admin123';
const SESSION_DURATION = 24 * 60 * 60 * 1000; // 24 hours

// Authentication functions
function checkAuth() {
    const isLoggedIn = localStorage.getItem('adminLoggedIn');
    const loginTime = localStorage.getItem('adminLoginTime');
    
    if (!isLoggedIn || isLoggedIn !== 'true') {
        window.location.href = 'admin.html';
        return false;
    }
    
    if (loginTime && Date.now() - parseInt(loginTime) > SESSION_DURATION) {
        logout();
        return false;
    }
    
    return true;
}

function login(username, password) {
    if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
        localStorage.setItem('adminLoggedIn', 'true');
        localStorage.setItem('adminLoginTime', Date.now().toString());
        return true;
    }
    return false;
}

function logout() {
    localStorage.removeItem('adminLoggedIn');
    localStorage.removeItem('adminLoginTime');
    window.location.href = 'admin.html';
}

// Dashboard functions
async function loadDashboardData() {
    try {
        const { data: bookings, error } = await supabaseClient
            .from('bookings')
            .select('*')
            .order('created_at', { ascending: false });
        
        if (error) throw error;
        
        updateStats(bookings);
        updateRecentBookings(bookings);
    } catch (error) {
        console.error('Error loading dashboard data:', error);
    }
}

function updateStats(bookings) {
    const totalBookings = bookings.length;
    const activeBookings = bookings.filter(b => b.status === 'confirmed').length;
    const pendingBookings = bookings.filter(b => b.status === 'pending').length;
    
    // Calculate revenue (assuming average price per night = 2000 UAH)
    const revenue = bookings
        .filter(b => b.status === 'confirmed')
        .reduce((total, booking) => {
            const nights = Math.ceil((new Date(booking.check_out) - new Date(booking.check_in)) / (1000 * 60 * 60 * 24));
            return total + (nights * 2000);
        }, 0);
    
    // Calculate occupancy (simplified)
    const occupancy = totalBookings > 0 ? Math.round((activeBookings / totalBookings) * 100) : 0;
    
    // Update stats with animation
    animateValue('total-bookings', totalBookings);
    animateValue('active-bookings', activeBookings);
    animateValue('revenue', revenue, '₴');
    animateValue('occupancy', occupancy, '%');
}

function animateValue(elementId, endValue, suffix = '') {
    const element = document.getElementById(elementId);
    if (!element) return;
    
    const startValue = 0;
    const duration = 1500;
    const startTime = performance.now();
    
    function update(currentTime) {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);
        
        const easeOutQuart = 1 - Math.pow(1 - progress, 4);
        const currentValue = Math.floor(startValue + (endValue - startValue) * easeOutQuart);
        
        element.textContent = currentValue.toLocaleString() + suffix;
        
        if (progress < 1) {
            requestAnimationFrame(update);
        }
    }
    
    requestAnimationFrame(update);
}

function updateRecentBookings(bookings) {
    const container = document.querySelector('.recent-bookings');
    if (!container) return;
    
    if (bookings.length === 0) {
        container.innerHTML = `
            <div class="placeholder-content">
                <div class="icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                        <polyline points="14 2 14 8 20 8"/>
                        <line x1="16" y1="13" x2="8" y2="13"/>
                        <line x1="16" y1="17" x2="8" y2="17"/>
                        <polyline points="10 9 9 9 8 9"/>
                    </svg>
                </div>
                <p>Немає бронювань</p>
                <p>Бронювання будуть відображатися тут після інтеграції з базою даних</p>
            </div>
        `;
        return;
    }
    
    const recentBookings = bookings.slice(0, 5);
    container.innerHTML = recentBookings.map(booking => `
        <div class="booking-item">
            <div class="booking-info">
                <h4>${booking.guest_name}</h4>
                <p>${formatDate(booking.check_in)} - ${formatDate(booking.check_out)}</p>
                <p>${booking.adults_count} дорослих, ${booking.children_count} дітей</p>
            </div>
            <div class="booking-status ${booking.status}">
                ${getStatusLabel(booking.status)}
            </div>
        </div>
    `).join('');
}

// Bookings functions
async function loadBookings() {
    try {
        const { data: bookings, error } = await supabaseClient
            .from('bookings')
            .select('*')
            .order('created_at', { ascending: false });
        
        if (error) throw error;
        
        renderBookings(bookings);
    } catch (error) {
        console.error('Error loading bookings:', error);
        document.getElementById('bookings-table-body').innerHTML = `
            <tr>
                <td colspan="7" style="text-align: center; padding: 40px; color: rgba(239, 68, 68, 0.7);">
                    Помилка завантаження даних
                </td>
            </tr>
        `;
    }
}

function renderBookings(bookings) {
    const tbody = document.getElementById('bookings-table-body');
    
    if (bookings.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7" style="text-align: center; padding: 40px; color: rgba(255, 255, 255, 0.5);">
                    Немає бронювань
                </td>
            </tr>
        `;
        return;
    }
    
    tbody.innerHTML = bookings.map(booking => `
        <tr>
            <td>${booking.guest_name}</td>
            <td>${booking.guest_phone}</td>
            <td>${formatDate(booking.check_in)}</td>
            <td>${formatDate(booking.check_out)}</td>
            <td>${booking.adults_count} дор., ${booking.children_count} діт.</td>
            <td><span class="status-badge ${booking.status}">${getStatusLabel(booking.status)}</span></td>
            <td>
                <div class="action-buttons">
                    ${booking.status === 'pending' ? `
                        <button class="btn-action btn-confirm" onclick="updateStatus('${booking.id}', 'confirmed')">Підтвердити</button>
                        <button class="btn-action btn-cancel" onclick="updateStatus('${booking.id}', 'cancelled')">Скасувати</button>
                    ` : ''}
                    <button class="btn-action btn-view" onclick="viewBooking('${booking.id}')">Деталі</button>
                </div>
            </td>
        </tr>
    `).join('');
}

async function updateStatus(bookingId, newStatus) {
    try {
        const { error } = await supabaseClient
            .from('bookings')
            .update({ status: newStatus })
            .eq('id', bookingId);
        
        if (error) throw error;
        
        loadBookings();
    } catch (error) {
        console.error('Error updating status:', error);
        alert('Помилка оновлення статусу');
    }
}

function viewBooking(bookingId) {
    alert('Деталі бронювання: ' + bookingId);
}

// Clients functions
async function loadClients() {
    try {
        const { data: bookings, error } = await supabaseClient
            .from('bookings')
            .select('*')
            .order('created_at', { ascending: false });
        
        if (error) throw error;
        
        // Group bookings by client
        const clientsMap = new Map();
        bookings.forEach(booking => {
            const key = booking.guest_name + booking.guest_phone;
            if (!clientsMap.has(key)) {
                clientsMap.set(key, {
                    name: booking.guest_name,
                    phone: booking.guest_phone,
                    bookings: [],
                    lastBooking: booking.created_at
                });
            }
            clientsMap.get(key).bookings.push(booking);
            if (new Date(booking.created_at) > new Date(clientsMap.get(key).lastBooking)) {
                clientsMap.get(key).lastBooking = booking.created_at;
            }
        });
        
        const clients = Array.from(clientsMap.values());
        renderClients(clients);
    } catch (error) {
        console.error('Error loading clients:', error);
        document.getElementById('clients-table-body').innerHTML = `
            <tr>
                <td colspan="4" style="text-align: center; padding: 40px; color: rgba(239, 68, 68, 0.7);">
                    Помилка завантаження даних
                </td>
            </tr>
        `;
    }
}

function renderClients(clients) {
    const tbody = document.getElementById('clients-table-body');
    
    if (clients.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="4" style="text-align: center; padding: 40px; color: rgba(255, 255, 255, 0.5);">
                    Немає клієнтів
                </td>
            </tr>
        `;
        return;
    }
    
    tbody.innerHTML = clients.map(client => `
        <tr>
            <td>
                <div class="client-info">
                    <div class="client-avatar">${client.name.charAt(0).toUpperCase()}</div>
                    <div>
                        <div class="client-name">${client.name}</div>
                        <div class="client-phone">${client.phone}</div>
                    </div>
                </div>
            </td>
            <td>${client.phone}</td>
            <td><span class="bookings-count">${client.bookings.length}</span></td>
            <td>${formatDate(client.lastBooking)}</td>
        </tr>
    `).join('');
}

// Utility functions
function formatDate(dateStr) {
    const date = new Date(dateStr);
    return date.toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function getStatusLabel(status) {
    const labels = {
        'pending': 'Очікує',
        'confirmed': 'Підтверджено',
        'cancelled': 'Скасовано'
    };
    return labels[status] || status;
}

// Navigation functions
function showSection(sectionId) {
    // Hide all sections
    document.querySelectorAll('.section').forEach(section => {
        section.classList.remove('active');
    });
    
    // Show selected section
    const targetSection = document.getElementById(sectionId);
    if (targetSection) {
        targetSection.classList.add('active');
    }
    
    // Update menu active state
    document.querySelectorAll('.menu-item').forEach(item => {
        item.classList.remove('active');
    });
    
    const activeMenuItem = document.querySelector(`[data-section="${sectionId}"]`);
    if (activeMenuItem) {
        activeMenuItem.classList.add('active');
    }
}

// Initialize menu navigation
function initMenuNavigation() {
    document.querySelectorAll('.menu-item').forEach(item => {
        item.addEventListener('click', function() {
            const sectionId = this.getAttribute('data-section');
            if (sectionId) {
                showSection(sectionId);
            }
        });
    });
}

// Login form handling
function initLoginForm() {
    const loginForm = document.getElementById('login-form');
    if (loginForm) {
        loginForm.addEventListener('submit', function(e) {
            e.preventDefault();
            
            const username = document.getElementById('username').value;
            const password = document.getElementById('password').value;
            const loginBtn = document.getElementById('login-btn');
            const errorMessage = document.getElementById('error-message');
            
            // Show loading state
            loginBtn.classList.add('loading');
            loginBtn.textContent = 'Вхід...';
            
            // Simulate network delay
            setTimeout(() => {
                if (login(username, password)) {
                    window.location.href = 'dashboard.html';
                } else {
                    errorMessage.classList.add('show');
                    loginBtn.classList.remove('loading');
                    loginBtn.textContent = 'Увійти';
                    
                    // Hide error after 3 seconds
                    setTimeout(() => {
                        errorMessage.classList.remove('show');
                    }, 3000);
                }
            }, 500);
        });
    }
}

// Cottage functions
async function loadCottages() {
    try {
        const { data: cottages, error } = await supabaseClient
            .from('cottages')
            .select('*')
            .order('created_at', { ascending: false });
        
        if (error) throw error;
        
        renderCottages(cottages);
    } catch (error) {
        console.error('Error loading cottages:', error);
        document.getElementById('cottages-grid').innerHTML = `
            <div style="grid-column: 1 / -1; text-align: center; padding: 40px; color: rgba(239, 68, 68, 0.7);">
                Помилка завантаження котеджів
            </div>
        `;
    }
}

function renderCottages(cottages) {
    const container = document.getElementById('cottages-grid');
    
    if (cottages.length === 0) {
        container.innerHTML = `
            <div style="grid-column: 1 / -1; text-align: center; padding: 40px; color: rgba(255, 255, 255, 0.5);">
                <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="margin-bottom: 16px; opacity: 0.5;">
                    <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
                    <polyline points="9 22 9 12 15 12 15 22"/>
                </svg>
                <p>Немає котеджів</p>
                <p>Додайте перший котедж, натиснувши кнопку "Додати котедж"</p>
            </div>
        `;
        return;
    }
    
    container.innerHTML = cottages.map(cottage => {
        const photos = cottage.photos ? cottage.photos.split(',').map(p => p.trim()) : [];
        const firstPhoto = photos.length > 0 ? photos[0] : null;
        
        return `
            <div class="cottage-card">
                <div class="cottage-card-image">
                    ${firstPhoto 
                        ? `<img src="${firstPhoto}" alt="${cottage.name}" onerror="this.parentElement.innerHTML='<div class=\\'placeholder\\'><svg viewBox=\\'0 0 24 24\\' fill=\\'none\\' stroke=\\'currentColor\\' stroke-width=\\'2\\'><path d=\\'M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z\\'/><polyline points=\\'9 22 9 12 15 12 15 22\\'/></svg></div>'">`
                        : `<div class="placeholder">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
                                <polyline points="9 22 9 12 15 12 15 22"/>
                            </svg>
                           </div>`
                    }
                </div>
                <h3>${cottage.name}</h3>
                <div class="cottage-info">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                        <circle cx="9" cy="7" r="4"/>
                    </svg>
                    до ${cottage.guest_count} гостей
                </div>
                <div class="cottage-info">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
                    </svg>
                    ${cottage.bedrooms} спалень, ${cottage.floors} поверхів
                </div>
                <div class="cottage-info">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                        <line x1="16" y1="2" x2="16" y2="6"/>
                        <line x1="8" y1="2" x2="8" y2="6"/>
                        <line x1="3" y1="10" x2="21" y2="10"/>
                    </svg>
                    №: ${cottage.cottage_numbers}
                </div>
                <div class="price">${parseFloat(cottage.price).toLocaleString('uk-UA')} ₴ <span>/ ніч</span></div>
                <div class="status ${cottage.status}">${cottage.status === 'active' ? 'Активний' : 'Неактивний'}</div>
                <div class="cottage-actions">
                    <button class="btn-action btn-edit" onclick="editCottage('${cottage.id}')">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                        </svg>
                        Редагувати
                    </button>
                    <button class="btn-action btn-delete" onclick="deleteCottage('${cottage.id}')">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="3 6 5 6 21 6"/>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                        </svg>
                        Видалити
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

function openCottageModal(cottage = null) {
    const modal = document.getElementById('cottage-modal');
    const title = document.getElementById('modal-title');
    const form = document.getElementById('cottage-form');
    
    form.reset();
    document.getElementById('cottage-id').value = '';
    
    if (cottage) {
        title.textContent = 'Редагувати котедж';
        document.getElementById('cottage-id').value = cottage.id;
        document.getElementById('cottage-name').value = cottage.name;
        document.getElementById('cottage-guests').value = cottage.guest_count;
        document.getElementById('cottage-numbers').value = cottage.cottage_numbers;
        document.getElementById('cottage-floors').value = cottage.floors;
        document.getElementById('cottage-bedrooms').value = cottage.bedrooms;
        document.getElementById('cottage-price').value = cottage.price;
        document.getElementById('cottage-tariff').value = cottage.tariff || '';
        document.getElementById('cottage-status').value = cottage.status;
        document.getElementById('cottage-description').value = cottage.description;
        document.getElementById('cottage-photos').value = cottage.photos || '';
    } else {
        title.textContent = 'Додати котедж';
    }
    
    modal.classList.add('active');
}

function closeCottageModal() {
    const modal = document.getElementById('cottage-modal');
    modal.classList.remove('active');
}

async function saveCottage(event) {
    event.preventDefault();
    
    const cottageId = document.getElementById('cottage-id').value;
    const cottageData = {
        name: document.getElementById('cottage-name').value,
        guest_count: parseInt(document.getElementById('cottage-guests').value),
        cottage_numbers: document.getElementById('cottage-numbers').value,
        floors: parseInt(document.getElementById('cottage-floors').value),
        bedrooms: parseInt(document.getElementById('cottage-bedrooms').value),
        price: parseFloat(document.getElementById('cottage-price').value),
        tariff: document.getElementById('cottage-tariff').value,
        status: document.getElementById('cottage-status').value,
        description: document.getElementById('cottage-description').value,
        photos: document.getElementById('cottage-photos').value
    };
    
    try {
        let error;
        if (cottageId) {
            // Update existing cottage
            const result = await supabaseClient
                .from('cottages')
                .update(cottageData)
                .eq('id', cottageId);
            error = result.error;
        } else {
            // Create new cottage
            const result = await supabaseClient
                .from('cottages')
                .insert([cottageData]);
            error = result.error;
        }
        
        if (error) throw error;
        
        closeCottageModal();
        loadCottages();
    } catch (error) {
        console.error('Error saving cottage:', error);
        alert('Помилка збереження котеджу');
    }
}

async function editCottage(cottageId) {
    try {
        const { data: cottage, error } = await supabaseClient
            .from('cottages')
            .select('*')
            .eq('id', cottageId)
            .single();
        
        if (error) throw error;
        
        openCottageModal(cottage);
    } catch (error) {
        console.error('Error loading cottage:', error);
        alert('Помилка завантаження котеджу');
    }
}

async function deleteCottage(cottageId) {
    if (!confirm('Ви впевнені, що хочете видалити цей котедж?')) {
        return;
    }
    
    try {
        const { error } = await supabaseClient
            .from('cottages')
            .delete()
            .eq('id', cottageId);
        
        if (error) throw error;
        
        loadCottages();
    } catch (error) {
        console.error('Error deleting cottage:', error);
        alert('Помилка видалення котеджу');
    }
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', function() {
    // Check if we're on login page
    if (document.getElementById('login-form')) {
        initLoginForm();
    } else {
        // Check authentication for admin pages
        if (checkAuth()) {
            initMenuNavigation();
            
            // Load data based on current section
            const activeSection = document.querySelector('.section.active');
            if (activeSection) {
                const sectionId = activeSection.id;
                if (sectionId === 'dashboard-section') {
                    loadDashboardData();
                } else if (sectionId === 'bookings-section') {
                    loadBookings();
                } else if (sectionId === 'clients-section') {
                    loadClients();
                } else if (sectionId === 'cottages-section') {
                    loadCottages();
                }
            }
        }
    }
});
