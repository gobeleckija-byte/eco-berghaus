// Supabase configuration
const SUPABASE_URL = 'https://xrebwszduxjnuynjownd.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_TyHq1pSH1Fx1VruiJ_XF2w_GZqEU6RT';
const ADMIN_AUTH_URL = SUPABASE_URL + '/functions/v1/admin-auth';

const supabaseClient = (window.supabase && typeof window.supabase.createClient === 'function')
    ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    : null;

// State management for 2FA flow (login page)
let currentSessionId = null;
let currentLoginUsername = null;
let otpTimerInterval = null;
let lockoutTimerInterval = null;

// State for dashboard
let adminToken = null;
let currentUser = null;
let allBookings = [];
let allCottages = [];
let allPromos = [];
let toastTimer = null;

// ============================================================================
// 1. АВТЕНТИФІКАЦІЯ ТА ПЕРЕВІРКА СЕСІЇ
// ============================================================================

function checkAuth() {
    const sessionRaw = sessionStorage.getItem('admin_secure_session');
    if (!sessionRaw) {
        window.location.href = '/admin';
        return false;
    }

    try {
        const session = JSON.parse(sessionRaw);
        if (!session.token || !session.expires_at || Date.now() > session.expires_at) {
            logout();
            return false;
        }
        adminToken = session.token;
        currentUser = session.username || session.email || 'admin';
        return true;
    } catch (e) {
        logout();
        return false;
    }
}

function logout() {
    // Спочатку чистимо клієнтську сесію — захист дашборда не залежить від решти
    try { sessionStorage.removeItem('admin_secure_session'); } catch (e) {}
    try { localStorage.removeItem('admin_secure_session'); } catch (e) {}

    // Best-effort: завершуємо серверну сесію
    try {
        if (adminToken && supabaseClient) {
            supabaseClient.rpc('admin_logout', { p_token: adminToken }).catch(() => {});
        }
        if (supabaseClient && supabaseClient.auth && typeof supabaseClient.auth.signOut === 'function') {
            supabaseClient.auth.signOut().catch(() => {});
        }
    } catch (e) {
        console.error('Logout cleanup error:', e);
    }
    window.location.href = '/admin';
}

// ============================================================================
// 2. ДОПОМІЖНІ UI ФУНКЦІЇ
// ============================================================================

function showError(msg) {
    const errBox = document.getElementById('error-message');
    if (errBox) {
        errBox.textContent = msg;
        errBox.style.display = 'block';
    }
}

function hideError() {
    const errBox = document.getElementById('error-message');
    if (errBox) errBox.style.display = 'none';
}

// Запуск таймера блокування (Anti-Brute Force Lockout)
function startLockoutTimer(seconds) {
    const lockoutCard = document.getElementById('lockout-card');
    const countdownEl = document.getElementById('lockout-countdown');
    const stepLogin = document.getElementById('step-login');
    const stepOtp = document.getElementById('step-otp');

    if (stepLogin) stepLogin.classList.add('hidden');
    if (stepOtp) stepOtp.classList.remove('active');
    if (lockoutCard) lockoutCard.classList.add('active');

    let remaining = seconds;
    clearInterval(lockoutTimerInterval);

    const updateDisplay = () => {
        const mins = Math.floor(remaining / 60);
        const secs = remaining % 60;
        if (countdownEl) countdownEl.textContent = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
        if (remaining <= 0) {
            clearInterval(lockoutTimerInterval);
            if (lockoutCard) lockoutCard.classList.remove('active');
            if (stepLogin) stepLogin.classList.remove('hidden');
            hideError();
        }
        remaining--;
    };

    updateDisplay();
    lockoutTimerInterval = setInterval(updateDisplay, 1000);
}

// Запуск таймера 2FA OTP (3 хвилини)
function startOtpTimer(seconds = 180) {
    const timerEl = document.getElementById('otp-timer');
    let remaining = seconds;
    clearInterval(otpTimerInterval);

    const updateDisplay = () => {
        const mins = Math.floor(remaining / 60);
        const secs = remaining % 60;
        if (timerEl) timerEl.textContent = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
        if (remaining <= 0) {
            clearInterval(otpTimerInterval);
            showError('Час дії коду вичерпано. Будь ласка, почніть вхід знову.');
            const verifyBtn = document.getElementById('verify-otp-btn');
            if (verifyBtn) verifyBtn.disabled = true;
        }
        remaining--;
    };

    updateDisplay();
    otpTimerInterval = setInterval(updateDisplay, 1000);
}

// ============================================================================
// 3. ІНІЦІАЛІЗАЦІЯ СТОРІНКИ ВХОДУ (admin.html)
// ============================================================================

document.addEventListener('DOMContentLoaded', () => {
    const loginForm = document.getElementById('login-form');
    const otpForm = document.getElementById('otp-form');
    const btnBack = document.getElementById('btn-back-to-login');
    const otpInputs = document.querySelectorAll('.otp-digit-input');

    // Якщо це dashboard.html — перевіряємо авторизацію та завантажуємо дані
    if (document.getElementById('dashboard-section') || document.getElementById('cottages-grid')) {
        if (checkAuth()) {
            initDashboard();
        }
        return;
    }

    // Налаштування полів введення 2FA OTP
    if (otpInputs && otpInputs.length > 0) {
        otpInputs.forEach((input, index) => {
            input.addEventListener('input', (e) => {
                const val = e.target.value;
                if (val.length >= 1) {
                    input.value = val.slice(-1);
                    if (index < otpInputs.length - 1) {
                        otpInputs[index + 1].focus();
                    }
                }
            });

            input.addEventListener('keydown', (e) => {
                if (e.key === 'Backspace' && !input.value && index > 0) {
                    otpInputs[index - 1].focus();
                }
            });

            input.addEventListener('paste', (e) => {
                e.preventDefault();
                const pasteData = (e.clipboardData || window.clipboardData).getData('text').trim();
                if (/^\d{6}$/.test(pasteData)) {
                    pasteData.split('').forEach((char, i) => {
                        if (otpInputs[i]) otpInputs[i].value = char;
                    });
                    otpInputs[5].focus();
                }
            });
        });
    }

    // Повернення до кроку 1
    if (btnBack) {
        btnBack.addEventListener('click', () => {
            clearInterval(otpTimerInterval);
            document.getElementById('step-otp').classList.remove('active');
            document.getElementById('step-login').classList.remove('hidden');
            document.getElementById('header-subtitle').textContent = 'Захищений вхід (2FA + Rate Limiting)';
            hideError();
        });
    }

    // ========================================================================
    // ОБРОБКА КРОКУ 1: ЛОГІН + ПАРОЛЬ -> ВІДПРАВКА 2FA В TELEGRAM
    // ========================================================================
    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            hideError();

            const usernameInput = document.getElementById('username');
            const passwordInput = document.getElementById('password');
            const submitBtn = document.getElementById('login-btn');

            const username = usernameInput.value.trim();
            const password = passwordInput.value;

            if (!username || !password) {
                showError('Будь ласка, заповніть всі поля');
                return;
            }

            submitBtn.disabled = true;
            submitBtn.innerHTML = 'Перевірка...';

            try {
                // Вхід обробляє edge-функція: OTP генерується і надсилається
                // в Telegram на сервері, клієнт код не бачить
                const res = await fetch(ADMIN_AUTH_URL, {
                    method: 'POST',
                    headers: {
                        'Authorization': 'Bearer ' + SUPABASE_ANON_KEY,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        action: 'initiate_login',
                        username: username,
                        password: password
                    })
                });

                const data = await res.json().catch(() => ({}));

                if (!res.ok && data.error) {
                    showError(data.error);
                    submitBtn.disabled = false;
                    submitBtn.innerHTML = 'Продовжити';
                    return;
                }

                // Перевірка результату Rate Limiter
                if (data.status === 'locked') {
                    startLockoutTimer(data.retry_after_seconds || 900);
                    submitBtn.disabled = false;
                    submitBtn.innerHTML = 'Продовжити';
                    return;
                }

                if (data.status === 'invalid_credentials') {
                    showError(`Невірний логін або пароль. Залишилось спроб: ${data.attempts_left}`);
                    submitBtn.disabled = false;
                    submitBtn.innerHTML = 'Продовжити';
                    return;
                }

                if (data.status === 'otp_sent') {
                    currentSessionId = data.session_id;
                    currentLoginUsername = data.username || username;

                    // Перемикання на крок 2FA
                    document.getElementById('step-login').classList.add('hidden');
                    document.getElementById('step-otp').classList.add('active');
                    document.getElementById('header-subtitle').textContent = `Введіть код, надісланий у Telegram`;

                    startOtpTimer(180);

                    // Фокус на перше поле OTP
                    setTimeout(() => {
                        const firstOtp = document.querySelector('.otp-digit-input');
                        if (firstOtp) firstOtp.focus();
                    }, 100);
                }
            } catch (err) {
                console.error('Login process error:', err);
                showError('Помилка з\'єднання. Спробуйте пізніше.');
            } finally {
                submitBtn.disabled = false;
                submitBtn.innerHTML = 'Продовжити';
            }
        });
    }

    // ========================================================================
    // ОБРОБКА КРОКУ 2: ВЕРИФІКАЦІЯ 2FA OTP ТА СТВОРЕННЯ СЕСІЇ
    // ========================================================================
    if (otpForm) {
        otpForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            hideError();

            const otpDigits = Array.from(document.querySelectorAll('.otp-digit-input')).map(i => i.value).join('');
            const verifyBtn = document.getElementById('verify-otp-btn');
            const attemptsBadge = document.getElementById('attempts-badge');

            if (otpDigits.length !== 6) {
                showError('Введіть повний 6-значний код');
                return;
            }

            if (!currentSessionId) {
                showError('Сесія 2FA не знайдена. Почніть вхід спочатку.');
                return;
            }

            verifyBtn.disabled = true;
            verifyBtn.innerHTML = 'Перевірка коду...';

            try {
                // Верифікація через edge-функцію: повертає серверний токен сесії
                const res = await fetch(ADMIN_AUTH_URL, {
                    method: 'POST',
                    headers: {
                        'Authorization': 'Bearer ' + SUPABASE_ANON_KEY,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        action: 'verify_otp',
                        session_id: currentSessionId,
                        otp_code: otpDigits
                    })
                });

                const data = await res.json().catch(() => ({}));

                if (!res.ok && data.error) {
                    showError(data.error);
                    verifyBtn.disabled = false;
                    verifyBtn.innerHTML = 'Підтвердити вхід';
                    return;
                }

                if (data.status === 'expired') {
                    showError(data.message || 'Сесія OTP недійсна або вичерпана. Спробуйте увійти знову.');
                    clearInterval(otpTimerInterval);
                    verifyBtn.disabled = true;
                    return;
                }

                if (data.status === 'invalid_otp') {
                    if (attemptsBadge) attemptsBadge.textContent = `Спроб: ${data.attempts_left}/3`;
                    showError(`Невірний код. Залишилось спроб: ${data.attempts_left}`);
                    verifyBtn.disabled = false;
                    verifyBtn.innerHTML = 'Підтвердити вхід';

                    // Очищуємо поля OTP
                    document.querySelectorAll('.otp-digit-input').forEach(i => i.value = '');
                    const firstInput = document.querySelector('.otp-digit-input');
                    if (firstInput) firstInput.focus();
                    return;
                }

                if (data.status === 'authenticated') {
                    clearInterval(otpTimerInterval);

                    // Зберігаємо сесію з серверним токеном (2 години)
                    const sessionData = {
                        token: data.session_token,
                        user_id: data.user_id,
                        username: currentLoginUsername,
                        role: 'admin',
                        created_at: Date.now(),
                        expires_at: Date.now() + (2 * 60 * 60 * 1000) // 2 hours
                    };

                    sessionStorage.setItem('admin_secure_session', JSON.stringify(sessionData));

                    verifyBtn.innerHTML = '✓ Успішно! Вхід...';
                    setTimeout(() => {
                        window.location.href = '/dashboard';
                    }, 500);
                }
            } catch (err) {
                console.error('OTP verify failed:', err);
                showError('Помилка обробки 2FA. Спробуйте пізніше.');
                verifyBtn.disabled = false;
                verifyBtn.innerHTML = 'Підтвердити вхід';
            }
        });
    }
});

// ============================================================================
// 4. ДАШБОРД (dashboard.html)
// ============================================================================

// ---------- Сесія: лічильник, пролонгація, автоматичний вихід ----------

const SESSION_TTL_MS = 2 * 60 * 60 * 1000; // 2 години, як на сервері
let sessionWatchInterval = null;
let sessionEnding = false;

// Дзеркалимо серверну пролонгацію: кожна успішна операція адмінки подовжує сесію
function refreshClientSession() {
    const raw = sessionStorage.getItem('admin_secure_session');
    if (!raw) return;
    try {
        const session = JSON.parse(raw);
        session.expires_at = Date.now() + SESSION_TTL_MS;
        sessionStorage.setItem('admin_secure_session', JSON.stringify(session));
    } catch (e) { /* ignore */ }
}

function formatRemaining(ms) {
    if (ms <= 0) return '0 хв';
    const mins = Math.floor(ms / 60000);
    if (mins >= 60) {
        const h = Math.floor(mins / 60);
        const m = mins % 60;
        return m > 0 ? `${h} год ${m} хв` : `${h} год`;
    }
    return `${mins} хв`;
}

function startSessionWatch() {
    updateSessionTimer();

    if (sessionWatchInterval) clearInterval(sessionWatchInterval);
    sessionWatchInterval = setInterval(() => {
        if (sessionEnding) return;
        updateSessionTimer();

        const raw = sessionStorage.getItem('admin_secure_session');
        if (!raw) return;
        try {
            const session = JSON.parse(raw);
            if (Date.now() > session.expires_at) {
                sessionEnding = true;
                clearInterval(sessionWatchInterval);
                showToast('Час сесії вичерпано. Виконуємо вихід...', 'error');
                setTimeout(logout, 1500);
            }
        } catch (e) {
            logout();
        }
    }, 30000);
}

function updateSessionTimer() {
    const timerEl = document.getElementById('session-timer');
    if (!timerEl) return;

    const raw = sessionStorage.getItem('admin_secure_session');
    if (!raw) return;
    try {
        const session = JSON.parse(raw);
        const remaining = session.expires_at - Date.now();
        timerEl.textContent = remaining > 0
            ? `⏱ Сесія: ${formatRemaining(remaining)}`
            : '⏱ Сесія: завершується...';
    } catch (e) { /* ignore */ }
}

function initDashboard() {
    // Ім'я адміністратора в сайдбарі
    const userLabel = document.getElementById('admin-username-label');
    if (userLabel) userLabel.textContent = 'Користувач: ' + currentUser;

    // Автоматичний вихід при закінченні сесії + лічильник часу в сайдбарі
    startSessionWatch();

    const sidebar = document.querySelector('.sidebar');
    const mobileMenuToggle = document.getElementById('mobile-menu-toggle');

    const setMobileMenuOpen = (isOpen) => {
        if (!sidebar || !mobileMenuToggle) return;
        sidebar.classList.toggle('menu-open', isOpen);
        mobileMenuToggle.setAttribute('aria-expanded', String(isOpen));
        mobileMenuToggle.setAttribute('aria-label', isOpen ? 'Закрити меню' : 'Відкрити меню');
        mobileMenuToggle.setAttribute('title', isOpen ? 'Закрити меню' : 'Відкрити меню');
    };

    if (mobileMenuToggle) {
        mobileMenuToggle.addEventListener('click', () => {
            setMobileMenuOpen(!sidebar?.classList.contains('menu-open'));
        });
    }

    // Перемикання розділів меню
    const menuItems = document.querySelectorAll('.menu-item[data-section]');
    menuItems.forEach(item => {
        item.addEventListener('click', () => {
            menuItems.forEach(mi => mi.classList.remove('active'));
            item.classList.add('active');

            document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
            const target = document.getElementById(item.dataset.section);
            if (target) target.classList.add('active');
            setMobileMenuOpen(false);
        });
    });

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') setMobileMenuOpen(false);
    });

    // Завантаження фото котеджу файлами
    const photoFileInput = document.getElementById('c-photo-file');
    if (photoFileInput) {
        photoFileInput.addEventListener('change', (e) => {
            const files = Array.from(e.target.files || []);
            if (files.length > 0) uploadCottagePhotos(files);
        });
    }

    loadDashboardData();
}

async function loadDashboardData() {
    try {
        const { data, error } = await supabaseClient.rpc('admin_get_dashboard', {
            p_token: adminToken
        });

        if (error) throw error;

        if (!data || data.status === 'unauthorized') {
            showToast('Сесію завершено. Увійдіть знову.', 'error');
            setTimeout(logout, 1200);
            return;
        }

        allBookings = data.bookings || [];
        allCottages = data.cottages || [];

        refreshClientSession();
        updateSessionTimer();

        updateStats();
        renderRecentBookings();
        renderBookings();
        renderCottages();
        renderClients();
        loadPromos();
        loadSiteSettings();
    } catch (error) {
        console.error('Error loading dashboard data:', error);
        showToast('Не вдалося завантажити дані. Оновіть сторінку.', 'error');
    }
}

function updateStats() {
    const total = allBookings.length;
    const confirmed = allBookings.filter(b => b.status === 'confirmed').length;
    const pending = allBookings.filter(b => b.status === 'pending').length;
    const activeCottages = allCottages.filter(c => c.status === 'active').length;

    animateValue('total-bookings', total);
    animateValue('confirmed-bookings', confirmed);
    animateValue('pending-bookings', pending);
    animateValue('active-cottages', activeCottages);
}

function animateValue(elementId, endValue, suffix = '') {
    const element = document.getElementById(elementId);
    if (!element) return;

    const startValue = 0;
    const duration = 1200;
    const startTime = performance.now();

    function update(currentTime) {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const easeOutQuart = 1 - Math.pow(1 - progress, 4);
        const currentValue = Math.floor(startValue + (endValue - startValue) * easeOutQuart);
        element.textContent = currentValue.toLocaleString('uk-UA') + suffix;
        if (progress < 1) requestAnimationFrame(update);
    }

    requestAnimationFrame(update);
}

// ---------- Допоміжні функції відображення ----------

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
}

function formatDate(value) {
    if (!value) return '—';
    return new Date(value).toLocaleDateString('uk-UA');
}

function statusBadge(status) {
    const map = {
        pending: ['badge-pending', 'Очікує'],
        confirmed: ['badge-confirmed', 'Підтверджено'],
        cancelled: ['badge-cancelled', 'Скасовано']
    };
    const [cls, text] = map[status] || ['badge-pending', status];
    return `<span class="badge ${cls}">${text}</span>`;
}

function cottageName(cottageId) {
    const cottage = allCottages.find(c => c.id === cottageId);
    return cottage ? cottage.name : '—';
}

// ---------- Останні бронювання (головний розділ) ----------

function renderRecentBookings() {
    const tbody = document.getElementById('recent-tbody');
    if (!tbody) return;

    if (allBookings.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:24px; color:#5f8a7c;">Бронювань поки немає</td></tr>';
        return;
    }

    tbody.innerHTML = allBookings.slice(0, 10).map(b => `
        <tr>
            <td><strong>${escapeHtml(b.guest_name || 'Гість')}</strong></td>
            <td>${escapeHtml(b.guest_phone || '-')}</td>
            <td>${formatDate(b.check_in)}</td>
            <td>${formatDate(b.check_out)}</td>
            <td>${statusBadge(b.status)}</td>
            <td>
                <button class="btn-sm btn-edit" onclick="openBookingDetails('${b.id}')">Деталі</button>
            </td>
        </tr>
    `).join('');
}

// ---------- Розділ "Бронювання" з фільтрами ----------

function renderBookings() {
    const tbody = document.getElementById('bookings-tbody');
    if (!tbody) return;

    const statusFilterEl = document.getElementById('status-filter');
    const searchEl = document.getElementById('search-input');
    const statusFilter = statusFilterEl ? statusFilterEl.value : '';
    const search = searchEl ? searchEl.value.trim().toLowerCase() : '';

    let list = allBookings;
    if (statusFilter) {
        list = list.filter(b => b.status === statusFilter);
    }
    if (search) {
        list = list.filter(b =>
            (b.guest_name || '').toLowerCase().includes(search) ||
            (b.guest_phone || '').toLowerCase().includes(search)
        );
    }

    if (list.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:30px; color:#5f8a7c;">Бронювань не знайдено</td></tr>';
        return;
    }

    tbody.innerHTML = list.map(b => {
        const guests = `${b.adults_count || 1} дор. + ${b.children_count || 0} діт.`;
        const actions = `
            <button class="btn-sm btn-edit" onclick="openBookingDetails('${b.id}')">Деталі</button>
            ${b.status !== 'confirmed' ? `<button class="btn-sm btn-confirm" onclick="setBookingStatus('${b.id}', 'confirmed')">Підтвердити</button>` : ''}
            ${b.status !== 'cancelled' ? `<button class="btn-sm btn-delete" onclick="setBookingStatus('${b.id}', 'cancelled')">Скасувати</button>` : ''}
            <button class="btn-sm btn-delete" onclick="deleteBooking('${b.id}')">Видалити</button>
        `;
        return `
            <tr>
                <td><strong>${escapeHtml(b.guest_name || 'Гість')}</strong></td>
                <td>${escapeHtml(b.guest_phone || '-')}</td>
                <td>${formatDate(b.check_in)}</td>
                <td>${formatDate(b.check_out)}</td>
                <td>${guests}</td>
                <td>${statusBadge(b.status)}</td>
                <td>${actions}</td>
            </tr>
        `;
    }).join('');
}

// ---------- Модалка бронювання ----------

function openBookingDetails(id) {
    const b = allBookings.find(x => x.id === id);
    if (!b) return;

    document.getElementById('booking-id').value = b.id || '';
    document.getElementById('b-guest-name').value = b.guest_name || '';
    document.getElementById('b-guest-phone').value = b.guest_phone || '';
    document.getElementById('b-checkin').value = b.check_in || '';
    document.getElementById('b-checkout').value = b.check_out || '';
    document.getElementById('b-adults').value = b.adults_count || 1;
    document.getElementById('b-children').value = b.children_count || 0;
    document.getElementById('b-status').value = b.status || 'pending';
    document.getElementById('b-notes').value = b.notes || '';

    const select = document.getElementById('b-cottage');
    if (select) {
        select.innerHTML = '<option value="">— Не обрано —</option>' +
            allCottages.map(c =>
                `<option value="${c.id}" ${b.cottage_id === c.id ? 'selected' : ''}>${escapeHtml(c.name)}</option>`
            ).join('');
    }

    document.getElementById('modal-booking-title').textContent = 'Редагувати бронювання';
    openModal('modal-booking');
}

async function saveBooking() {
    const payload = {
        id: document.getElementById('booking-id').value,
        guest_name: document.getElementById('b-guest-name').value.trim(),
        guest_phone: document.getElementById('b-guest-phone').value.trim(),
        check_in: document.getElementById('b-checkin').value,
        check_out: document.getElementById('b-checkout').value,
        adults_count: parseInt(document.getElementById('b-adults').value, 10) || 1,
        children_count: parseInt(document.getElementById('b-children').value, 10) || 0,
        cottage_id: document.getElementById('b-cottage').value,
        status: document.getElementById('b-status').value,
        notes: document.getElementById('b-notes').value.trim()
    };

    if (!payload.guest_name || !payload.guest_phone || !payload.check_in || !payload.check_out) {
        showToast('Заповніть ім\'я, телефон та дати', 'error');
        return;
    }

    try {
        const { data, error } = await supabaseClient.rpc('admin_save_booking', {
            p_token: adminToken,
            p_data: payload
        });

        if (error) throw error;
        if (data.status === 'unauthorized') {
            showToast('Сесію завершено. Увійдіть знову.', 'error');
            setTimeout(logout, 1200);
            return;
        }

        closeModal('modal-booking');
        showToast('Бронювання збережено', 'success');
        await loadDashboardData();
    } catch (err) {
        console.error('Save booking error:', err);
        showToast('Помилка збереження бронювання', 'error');
    }
}

async function setBookingStatus(id, status) {
    const booking = allBookings.find(b => b.id === id);
    if (!booking) return;

    try {
        const { data, error } = await supabaseClient.rpc('admin_save_booking', {
            p_token: adminToken,
            p_data: { ...booking, status }
        });

        if (error) throw error;
        if (data.status === 'unauthorized') {
            showToast('Сесію завершено. Увійдіть знову.', 'error');
            setTimeout(logout, 1200);
            return;
        }

        showToast(status === 'confirmed' ? 'Бронювання підтверджено' : 'Бронювання скасовано', 'success');
        await loadDashboardData();
    } catch (err) {
        console.error('Update booking status error:', err);
        showToast('Помилка оновлення статусу', 'error');
    }
}

// ---------- Розділ "Промокоди" ----------

function renderPromos() {
    const tbody = document.getElementById('promos-tbody');
    if (!tbody) return;

    if (!allPromos || allPromos.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:30px; color:#5f8a7c;">Промокодів поки немає. Додайте перший.</td></tr>';
        return;
    }

    tbody.innerHTML = allPromos.map(p => {
        const uses = `${p.current_uses || 0}${p.max_uses ? ' / ' + p.max_uses : ' / ∞'}`;
        const validFrom = p.valid_from ? formatDate(p.valid_from) : '—';
        const validUntil = p.valid_until ? formatDate(p.valid_until) : '—';
        const expired = p.valid_until && new Date(p.valid_until) < new Date();
        return `
            <tr>
                <td><strong>${escapeHtml(p.code)}</strong></td>
                <td>-${p.discount}%</td>
                <td><span class="badge ${p.active && !expired ? 'badge-active' : 'badge-inactive'}">${p.active && !expired ? 'Активний' : (expired ? 'Прострочений' : 'Вимкнений')}</span></td>
                <td>${uses}</td>
                <td>${validFrom} — ${validUntil}</td>
                <td>${escapeHtml(p.description || '—')}</td>
                <td>
                    <button class="btn-sm btn-edit" onclick="editPromo('${p.id}')">Редагувати</button>
                    <button class="btn-sm btn-delete" onclick="deletePromo('${p.id}')">Видалити</button>
                </td>
            </tr>
        `;
    }).join('');
}

function openPromoModal(id) {
    const p = id ? allPromos.find(x => x.id === id) : null;

    document.getElementById('modal-promo-title').textContent = p ? 'Редагувати промокод' : 'Додати промокод';
    document.getElementById('promo-id').value = p ? p.id : '';
    document.getElementById('p-code').value = p ? (p.code || '') : '';
    document.getElementById('p-discount').value = p ? (p.discount || '') : '';
    document.getElementById('p-max-uses').value = p && p.max_uses ? p.max_uses : '';
    document.getElementById('p-active').value = p ? String(!!p.active) : 'true';
    document.getElementById('p-valid-from').value = p && p.valid_from ? p.valid_from.slice(0, 10) : '';
    document.getElementById('p-valid-until').value = p && p.valid_until ? p.valid_until.slice(0, 10) : '';
    document.getElementById('p-description').value = p ? (p.description || '') : '';

    openModal('modal-promo');
}

function editPromo(id) {
    openPromoModal(id);
}

async function savePromo() {
    const payload = {
        id: document.getElementById('promo-id').value,
        code: document.getElementById('p-code').value.trim().toUpperCase(),
        discount: parseInt(document.getElementById('p-discount').value, 10),
        active: document.getElementById('p-active').value === 'true',
        max_uses: document.getElementById('p-max-uses').value.trim(),
        valid_from: document.getElementById('p-valid-from').value,
        valid_until: document.getElementById('p-valid-until').value,
        description: document.getElementById('p-description').value.trim()
    };

    if (!payload.code || !payload.discount) {
        showToast('Вкажіть код та розмір знижки', 'error');
        return;
    }

    try {
        const { data, error } = await supabaseClient.rpc('admin_save_promo', {
            p_token: adminToken,
            p_data: payload
        });

        if (error) throw error;
        if (data.status === 'unauthorized') {
            showToast('Сесію завершено. Увійдіть знову.', 'error');
            setTimeout(logout, 1200);
            return;
        }
        if (data.status === 'invalid') {
            showToast(data.message || 'Некоректні дані промокоду', 'error');
            return;
        }

        closeModal('modal-promo');
        showToast('Промокод збережено', 'success');
        await loadPromos();
    } catch (err) {
        console.error('Save promo error:', err);
        showToast('Помилка збереження промокоду', 'error');
    }
}

async function deletePromo(id) {
    if (!window.confirm('Видалити цей промокод?')) return;

    try {
        const { data, error } = await supabaseClient.rpc('admin_delete_promo', {
            p_token: adminToken,
            p_id: id
        });

        if (error) throw error;
        if (data.status === 'unauthorized') {
            showToast('Сесію завершено. Увійдіть знову.', 'error');
            setTimeout(logout, 1200);
            return;
        }

        showToast('Промокод видалено', 'success');
        await loadPromos();
    } catch (err) {
        console.error('Delete promo error:', err);
        showToast('Помилка видалення промокоду', 'error');
    }
}

async function loadPromos() {
    try {
        const { data, error } = await supabaseClient.rpc('admin_get_promos', {
            p_token: adminToken
        });

        if (error) throw error;
        if (!data || data.status === 'unauthorized') {
            showToast('Сесію завершено. Увійдіть знову.', 'error');
            setTimeout(logout, 1200);
            return;
        }

        allPromos = data.promos || [];
        refreshClientSession();
        updateSessionTimer();
        renderPromos();
    } catch (error) {
        console.error('Error loading promos:', error);
        showToast('Не вдалося завантажити промокоди', 'error');
    }
}

async function deleteBooking(id) {    if (!window.confirm('Видалити це бронювання?')) return;

    try {
        const { data, error } = await supabaseClient.rpc('admin_delete_booking', {
            p_token: adminToken,
            p_id: id
        });

        if (error) throw error;
        if (data.status === 'unauthorized') {
            showToast('Сесію завершено. Увійдіть знову.', 'error');
            setTimeout(logout, 1200);
            return;
        }

        showToast('Бронювання видалено', 'success');
        await loadDashboardData();
    } catch (err) {
        console.error('Delete booking error:', err);
        showToast('Помилка видалення бронювання', 'error');
    }
}

// ---------- Розділ "Котеджі" ----------

function renderCottages() {
    const grid = document.getElementById('cottages-grid');
    if (!grid) return;

    if (allCottages.length === 0) {
        grid.innerHTML = `
            <div style="grid-column:1/-1;">
                <div class="empty-state">
                    <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
                    <p>Котеджів поки немає. Додайте перший котедж.</p>
                </div>
            </div>`;
        return;
    }

    grid.innerHTML = allCottages.map(c => {
        const photos = parseCottagePhotos(c.photos);
        const photoAlt = `Котедж ${c.name} — оренда в Буковелі | EcoBerghaus`;
        const photoHtml = photos.length > 0
            ? `<img src="${escapeHtml(photos[0])}" alt="${escapeHtml(photoAlt)}" title="${escapeHtml(photoAlt)}"
                   loading="lazy"
                   style="width:100%; height:160px; object-fit:cover; border-radius:12px; margin-bottom:12px;"
                   onerror="this.style.display='none'">`
            : '';
        return `
        <div class="cottage-card">
            ${photoHtml}
            <div class="cottage-card-top">
                <div>
                    <div class="cottage-card-title">${escapeHtml(c.name)}</div>
                    <div class="cottage-card-meta">
                        Гостей: ${c.guest_count || '—'} • Номери: ${escapeHtml(c.cottage_numbers || '—')}<br>
                        Поверхів: ${c.floors || '—'} • Спалень: ${c.bedrooms || '—'} • <span style="color:#34d399; font-weight:500;">Тариф: ${escapeHtml(c.tariff || 'Rack Rate')}</span>
                    </div>
                </div>
                <span class="badge ${c.status === 'active' ? 'badge-active' : 'badge-inactive'}">
                    ${c.status === 'active' ? 'Активний' : 'Неактивний'}
                </span>
            </div>
            <div class="cottage-card-price">${Number(c.price || 0).toLocaleString('uk-UA')} ₴ / ніч</div>
            ${c.extra_bed_enabled ? `<div class="cottage-card-meta" style="color:#86efac; margin-bottom:8px;">Додаткове місце: +${Number(c.extra_bed_price || 0).toLocaleString('uk-UA')} ₴</div>` : ''}
            ${c.description ? `<div class="cottage-card-meta" style="max-height:80px; overflow:hidden; text-overflow:ellipsis; white-space:pre-line;">${escapeHtml(c.description)}</div>` : ''}
            <div class="cottage-card-actions">
                <button class="btn-sm btn-edit" onclick="editCottage('${c.id}')">Редагувати</button>
                <button class="btn-sm btn-delete" onclick="deleteCottage('${c.id}')">Видалити</button>
            </div>
        </div>
    `;}).join('');
}

// Фото котеджу зберігаються як список URL через кому (так само читає сайт)
function parseCottagePhotos(raw) {
    if (!raw) return [];
    const list = Array.isArray(raw) ? raw : String(raw).split(/[\n,]+/);
    return list.map(p => p.trim()).filter(Boolean);
}

// ---------- Менеджер фото котеджу (завантаження файлами) ----------

const COTTAGE_PHOTOS_URL = SUPABASE_URL + '/functions/v1/upload-cottage-photo';
let cottagePhotosState = [];

function renderCottagePhotosEditor() {
    const listEl = document.getElementById('c-photos-list');
    const hiddenEl = document.getElementById('c-photos');
    if (!listEl || !hiddenEl) return;

    const cottageName = (document.getElementById('c-name').value || 'котедж').trim();

    listEl.innerHTML = cottagePhotosState.map((url, i) => `
        <div style="position:relative; width:96px; height:76px; border-radius:10px; overflow:hidden; border:1px solid rgba(52,211,153,0.25);">
            <img src="${escapeHtml(url)}" alt="Фото ${i + 1}: котедж ${escapeHtml(cottageName)} — EcoBerghaus Буковель"
                 title="Котедж ${escapeHtml(cottageName)} — фото ${i + 1}" style="width:100%; height:100%; object-fit:cover;">
            <button type="button" onclick="removeCottagePhoto(${i})"
                    title="Видалити фото"
                    style="position:absolute; top:2px; right:2px; width:20px; height:20px; border:none; border-radius:6px; background:rgba(15,23,42,0.8); color:#f87171; font-size:12px; cursor:pointer; line-height:1;">✕</button>
            ${i === 0 ? '<span style="position:absolute; bottom:0; left:0; right:0; background:rgba(9,67,63,0.85); color:#ecfdf5; font-size:10px; text-align:center; padding:2px 0;">головне</span>' : ''}
        </div>
    `).join('');

    hiddenEl.value = cottagePhotosState.join(', ');
}

function removeCottagePhoto(index) {
    cottagePhotosState.splice(index, 1);
    renderCottagePhotosEditor();
}

async function uploadCottagePhotos(files) {
    const statusEl = document.getElementById('c-photo-upload-status');
    let uploaded = 0;

    for (const file of files) {
        if (statusEl) statusEl.textContent = `Завантаження ${file.name}...`;

        try {
            const fd = new FormData();
            fd.append('token', adminToken);
            fd.append('file', file);

            const res = await fetch(COTTAGE_PHOTOS_URL, {
                method: 'POST',
                headers: { 'Authorization': 'Bearer ' + SUPABASE_ANON_KEY },
                body: fd
            });
            const data = await res.json().catch(() => ({}));

            if (res.status === 401) {
                if (statusEl) statusEl.textContent = '';
                showToast('Сесію завершено. Увійдіть знову.', 'error');
                setTimeout(logout, 1500);
                return;
            }

            if (!res.ok || !data.url) {
                if (statusEl) statusEl.textContent = data.error || 'Помилка завантаження';
                continue;
            }

            cottagePhotosState.push(data.url);
            refreshClientSession();
            updateSessionTimer();
            uploaded++;
        } catch (err) {
            console.error('Photo upload error:', err);
            if (statusEl) statusEl.textContent = 'Помилка з\'єднання при завантаженні';
        }
    }

    renderCottagePhotosEditor();
    if (statusEl) {
        statusEl.textContent = uploaded > 0
            ? `Завантажено фото: ${uploaded}. Не забудьте зберегти котедж.`
            : '';
    }
}

function addFeatureChip(text) {
    const textarea = document.getElementById('c-features');
    if (!textarea) return;
    const current = textarea.value.trim();
    const bullet = text.startsWith('•') ? text : '• ' + text;
    if (current.includes(text)) return;
    textarea.value = current ? `${current}\n${bullet}` : bullet;
    textarea.focus();
}

function toggleExtraBedPriceInput() {
    const enabledInput = document.getElementById('c-extra-bed-enabled');
    const priceGroup = document.getElementById('c-extra-bed-price-group');
    if (!enabledInput || !priceGroup) return;

    priceGroup.style.display = enabledInput.checked ? 'block' : 'none';
}

function openCottageModal(id) {
    const c = id ? allCottages.find(x => x.id === id) : null;

    document.getElementById('modal-cottage-title').textContent = c ? 'Редагувати котедж' : 'Додати котедж';
    document.getElementById('cottage-id').value = c ? c.id : '';
    document.getElementById('c-name').value = c ? (c.name || '') : '';
    document.getElementById('c-tariff').value = c ? (c.tariff || 'Rack Rate') : 'Rack Rate';
    document.getElementById('c-guests').value = c ? (c.guest_count || 1) : '';
    document.getElementById('c-numbers').value = c ? (c.cottage_numbers || '') : '';
    document.getElementById('c-floors').value = c ? (c.floors || 1) : '';
    document.getElementById('c-bedrooms').value = c ? (c.bedrooms || 1) : '';
    document.getElementById('c-price').value = c ? (c.price || '') : '';
    document.getElementById('c-status').value = c ? (c.status || 'active') : 'active';
    document.getElementById('c-extra-bed-enabled').checked = Boolean(c && c.extra_bed_enabled);
    document.getElementById('c-extra-bed-price').value = c && c.extra_bed_price != null ? c.extra_bed_price : '';
    toggleExtraBedPriceInput();

    // Розбір опису на особливості (булети) та текстову примітку
    const desc = (c && c.description) ? c.description : '';
    const lines = desc.split('\n').map(l => l.trim()).filter(Boolean);
    const bullets = lines.filter(l => l.startsWith('•') || l.startsWith('-')).map(l => l.replace(/^[•\-]\s*/, ''));
    const notes = lines.filter(l => !l.startsWith('•') && !l.startsWith('-')).join('\n');

    document.getElementById('c-features').value = bullets.length > 0
        ? bullets.map(b => '• ' + b).join('\n')
        : (c ? '' : '• Кухня-студія зі зручним розкладним диваном\n• Спальня з королівським двоспальним ліжком\n• Санвузол з підігрівом підлоги та душовою\n• Простора тераса з власною зоною барбекю та меблями');
    document.getElementById('c-description').value = notes || (c ? '' : 'Комфортний котедж з усіма зручностями серед мальовничої природи Карпат.');

    cottagePhotosState = c ? parseCottagePhotos(c.photos) : [];
    renderCottagePhotosEditor();
    const statusEl = document.getElementById('c-photo-upload-status');
    if (statusEl) statusEl.textContent = '';
    const fileEl = document.getElementById('c-photo-file');
    if (fileEl) fileEl.value = '';

    openModal('modal-cottage');
}

function editCottage(id) {
    openCottageModal(id);
}

async function saveCottage() {
    const extraBedEnabled = document.getElementById('c-extra-bed-enabled').checked;
    const extraBedPriceInput = document.getElementById('c-extra-bed-price');
    const extraBedPrice = parseFloat(extraBedPriceInput.value);

    if (extraBedEnabled && (!extraBedPriceInput.value.trim() || Number.isNaN(extraBedPrice) || extraBedPrice < 0)) {
        showToast('Вкажіть коректну вартість додаткового місця', 'error');
        return;
    }

    const rawFeatures = document.getElementById('c-features').value.trim();
    const featureLines = rawFeatures
        ? rawFeatures.split('\n').map(l => l.trim()).filter(Boolean).map(l => (l.startsWith('•') || l.startsWith('-')) ? l : '• ' + l)
        : [];
    const noteText = document.getElementById('c-description').value.trim();
    const combinedDescription = [...featureLines, ...(noteText ? [noteText] : [])].join('\n');

    const payload = {
        id: document.getElementById('cottage-id').value,
        name: document.getElementById('c-name').value.trim(),
        tariff: document.getElementById('c-tariff').value.trim() || 'Rack Rate',
        guest_count: parseInt(document.getElementById('c-guests').value, 10) || 1,
        cottage_numbers: document.getElementById('c-numbers').value.trim(),
        floors: parseInt(document.getElementById('c-floors').value, 10) || 1,
        bedrooms: parseInt(document.getElementById('c-bedrooms').value, 10) || 1,
        price: parseFloat(document.getElementById('c-price').value) || 0,
        extra_bed_enabled: extraBedEnabled,
        extra_bed_price: extraBedEnabled ? extraBedPrice : 0,
        status: document.getElementById('c-status').value,
        description: combinedDescription,
        photos: parseCottagePhotos(document.getElementById('c-photos').value).join(', ')
    };

    if (!payload.name) {
        showToast("Вкажіть назву котеджу", 'error');
        return;
    }

    try {
        const { data, error } = await supabaseClient.rpc('admin_save_cottage', {
            p_token: adminToken,
            p_data: payload
        });

        if (error) throw error;
        if (data.status === 'unauthorized') {
            showToast('Сесію завершено. Увійдіть знову.', 'error');
            setTimeout(logout, 1200);
            return;
        }

        closeModal('modal-cottage');
        showToast('Котедж збережено', 'success');
        await loadDashboardData();
    } catch (err) {
        console.error('Save cottage error:', err);
        showToast('Помилка збереження котеджу', 'error');
    }
}

async function deleteCottage(id) {
    if (!window.confirm('Видалити цей котедж? Бронювання, пов\'язані з ним, залишаться без прив\'язки.')) return;

    try {
        const { data, error } = await supabaseClient.rpc('admin_delete_cottage', {
            p_token: adminToken,
            p_id: id
        });

        if (error) throw error;
        if (data.status === 'unauthorized') {
            showToast('Сесію завершено. Увійдіть знову.', 'error');
            setTimeout(logout, 1200);
            return;
        }

        showToast('Котедж видалено', 'success');
        await loadDashboardData();
    } catch (err) {
        console.error('Delete cottage error:', err);
        showToast('Помилка видалення котеджу', 'error');
    }
}

// ---------- Розділ "Налаштування сайту" ----------

let allSiteSettings = {};

function showSettingsPanel(panelId) {
    const requestedPanel = document.getElementById(panelId);
    if (!requestedPanel) return;

    document.querySelectorAll('#settings-section .settings-panel').forEach(panel => {
        panel.classList.toggle('active', panel.id === panelId);
    });
    document.querySelectorAll('#settings-section .settings-tab').forEach(tab => {
        const isActive = tab.dataset.settingsPanel === panelId;
        tab.classList.toggle('active', isActive);
        tab.setAttribute('aria-selected', String(isActive));
    });
}

function updateSiteStatusPreview() {
    const sel = document.getElementById('set-site-closed');
    const icon = document.getElementById('site-status-icon');
    const card = document.getElementById('site-status-card');
    if (!sel || !icon || !card) return;

    const isClosed = sel.value === 'true';
    icon.textContent = isClosed ? '🔴' : '🟢';
    card.classList.toggle('is-closed', isClosed);

    const label = document.getElementById('site-status-label');
    if (label) label.textContent = isClosed ? 'Сайт закритий' : 'Сайт відкритий';
}

async function loadSiteSettings() {
    try {
        const { data, error } = await supabaseClient.rpc('admin_get_settings', {
            p_token: adminToken
        });

        if (error) throw error;
        if (!data || data.status === 'unauthorized') {
            return;
        }

        allSiteSettings = data.settings || {};
        renderSiteSettings(allSiteSettings);
    } catch (err) {
        console.error('Error loading site settings:', err);
        renderSiteSettings({});
    }
}

function renderSiteSettings(s) {
    const setVal = (id, val, defaultVal = '') => {
        const el = document.getElementById(id);
        if (el) el.value = (val != null && val !== '') ? val : defaultVal;
    };

    // Статус сайту (відкритий/закритий) + повідомлення закриття
    setVal('set-site-closed', s.site_closed === 'true' ? 'true' : 'false', 'false');
    setVal('set-site-closed-msg', s.site_closed_message, 'На даний момент сайт закритий. Зателефонуйте нам або напишіть у Telegram — і ми оформимо бронювання особисто.');
    updateSiteStatusPreview();

    // Умови тарифу
    const tariffInc = s.tariff_includes != null
        ? s.tariff_includes.split('|').join('\n')
        : 'Безкоштовне скасування бронювання за 7 днів до заїзду\nСніданок «Шведська лінія» включено у вартість\nБезлімітний доступ до басейну та SPA-комплексу Rosa';
    setVal('set-tariff-includes', tariffInc);

    // Інформаційний футер котеджу
    const footer = s.cottage_details_footer != null
        ? s.cottage_details_footer.split('|').join('\n')
        : 'Котеджі повністю оснащені усім необхідним для комфортного проживання — вам варто взяти лише особисті речі.\n* Додаткове місце в котеджі оплачується окремо.\nНа території містечка є всі необхідні зручності: ресторан, дитячий та спортивний майданчики, власна парковка, цілодобова охорона, спа-комплекс, а розваги курорту Буковель — всього за 2 км.\nДо зустрічі в EcoBerghaus! Чекаємо на знайомство з вами 💛';
    setVal('set-cottage-footer', footer);

    // Правила та терміни
    setVal('set-checkin-time', s.checkin_time, '15:00');
    setVal('set-checkout-time', s.checkout_time, '11:00');
    setVal('set-min-standard', s.min_stay_standard, '2');
    setVal('set-min-holidays', s.min_stay_holidays, '4');

    // Контакти
    setVal('set-contact-phone', s.contact_phone, '+38 (067) 000-00-00');
    setVal('set-contact-email', s.contact_email, 'booking.depart@gmail.com');
    setVal('set-contact-telegram', s.contact_telegram, 'https://t.me/ecoberghaus');
    setVal('set-contact-instagram', s.contact_instagram, 'https://instagram.com/ecoberghaus');
    setVal('set-contact-address', s.contact_address, 'Івано-Франківська область, с. Поляниця, ур. Прелуки, Буковель');

    // Реквізити
    setVal('set-payment-recipient', s.payment_recipient, 'ФОП EcoBerghaus');
    setVal('set-payment-edrpou', s.payment_edrpou, '00000000');
    setVal('set-payment-iban', s.payment_iban, 'UA000000000000000000000000000');
    setVal('set-payment-purpose', s.payment_purpose, 'Оплата за проживання у котеджі згідно рахунку');
}

async function saveAllSettings() {
    const getVal = (id) => (document.getElementById(id) ? document.getElementById(id).value.trim() : '');

    const tariffIncludes = getVal('set-tariff-includes').split('\n').map(l => l.trim()).filter(Boolean).join('|');
    const cottageFooter = getVal('set-cottage-footer').split('\n').map(l => l.trim()).filter(Boolean).join('|');

    const payload = {
        site_closed: getVal('set-site-closed') === 'true' ? 'true' : 'false',
        site_closed_message: getVal('set-site-closed-msg') || 'На даний момент сайт закритий.',
        tariff_includes: tariffIncludes,
        cottage_details_footer: cottageFooter,
        checkin_time: getVal('set-checkin-time') || '15:00',
        checkout_time: getVal('set-checkout-time') || '11:00',
        min_stay_standard: getVal('set-min-standard') || '2',
        min_stay_holidays: getVal('set-min-holidays') || '4',
        contact_phone: getVal('set-contact-phone'),
        contact_email: getVal('set-contact-email'),
        contact_telegram: getVal('set-contact-telegram'),
        contact_instagram: getVal('set-contact-instagram'),
        contact_address: getVal('set-contact-address'),
        payment_recipient: getVal('set-payment-recipient'),
        payment_edrpou: getVal('set-payment-edrpou'),
        payment_iban: getVal('set-payment-iban'),
        payment_purpose: getVal('set-payment-purpose')
    };

    try {
        const { data, error } = await supabaseClient.rpc('admin_save_settings', {
            p_token: adminToken,
            p_settings: payload
        });

        if (error) throw error;
        if (!data || data.status === 'unauthorized') {
            showToast('Сесію завершено. Увійдіть знову.', 'error');
            setTimeout(logout, 1200);
            return;
        }

        refreshClientSession();
        updateSessionTimer();
        showToast('Всі налаштування успішно збережено!', 'success');
        await loadSiteSettings();
    } catch (err) {
        console.error('Save site settings error:', err);
        showToast('Помилка збереження налаштувань', 'error');
    }
}

// ---------- Розділ "Клієнти" ----------

function renderClients() {
    const tbody = document.getElementById('clients-tbody');
    if (!tbody) return;

    const clients = new Map();
    allBookings.forEach(b => {
        const key = (b.guest_phone || '').trim() || (b.guest_name || '').trim();
        if (!key) return;

        if (!clients.has(key)) {
            clients.set(key, {
                name: b.guest_name || 'Гість',
                phone: b.guest_phone || '—',
                count: 0,
                last: null
            });
        }

        const client = clients.get(key);
        client.count++;
        const created = b.created_at ? new Date(b.created_at) : null;
        if (created && (!client.last || created > client.last)) {
            client.last = created;
        }
    });

    const rows = Array.from(clients.values()).sort((a, b) => {
        if (a.last && b.last) return b.last - a.last;
        if (a.last) return -1;
        if (b.last) return 1;
        return 0;
    });

    if (rows.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:30px; color:#5f8a7c;">Клієнтів поки немає</td></tr>';
        return;
    }

    tbody.innerHTML = rows.map(c => `
        <tr>
            <td><strong>${escapeHtml(c.name)}</strong></td>
            <td>${escapeHtml(c.phone)}</td>
            <td>${c.count}</td>
            <td>${c.last ? c.last.toLocaleDateString('uk-UA') : '—'}</td>
        </tr>
    `).join('');
}

// ---------- Загальні UI-елементи (модалки, toast) ----------

function openModal(id) {
    const modal = document.getElementById(id);
    if (modal) modal.classList.add('open');
}

function closeModal(id) {
    const modal = document.getElementById(id);
    if (modal) modal.classList.remove('open');
}

function showToast(message, type = 'success') {
    const toast = document.getElementById('toast');
    if (!toast) return;

    toast.textContent = message;
    toast.className = 'toast show ' + type;

    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
        toast.className = 'toast';
    }, 3000);
}
