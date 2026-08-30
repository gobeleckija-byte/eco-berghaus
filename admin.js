// Supabase configuration
const SUPABASE_URL = 'https://xrebwszduxjnuynjownd.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_TyHq1pSH1Fx1VruiJ_XF2w_GZqEU6RT';
const TELEGRAM_BOT_TOKEN = '8845339263:AAEyY_6gw1xQyJjqBOQ2kxp8tECYoWC2oRE';
const TELEGRAM_CHAT_ID = '2026196111';

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
let toastTimer = null;

// ============================================================================
// 1. АВТЕНТИФІКАЦІЯ ТА ПЕРЕВІРКА СЕСІЇ
// ============================================================================

function checkAuth() {
    const sessionRaw = sessionStorage.getItem('admin_secure_session');
    if (!sessionRaw) {
        window.location.href = 'admin.html';
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
    window.location.href = 'admin.html';
}

// ============================================================================
// 2. ДОПОМІЖНІ КРИПТОГРАФІЧНІ ТА UI ФУНКЦІЇ
// ============================================================================

function generateCSPRNG_OTP() {
    const arr = new Uint32Array(1);
    window.crypto.getRandomValues(arr);
    return (100000 + (arr[0] % 900000)).toString();
}

function generateCSPRNG_Salt() {
    const arr = new Uint8Array(16);
    window.crypto.getRandomValues(arr);
    return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}

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
                // Генерація 6-значного CSPRNG OTP та per-OTP солі
                const otpCode = generateCSPRNG_OTP();
                const otpSalt = generateCSPRNG_Salt();

                // Отримуємо ідентифікатор клієнта
                const clientIp = 'client-' + (navigator.userAgent.replace(/[^a-zA-Z0-9]/g, '').slice(0, 16));

                // Виклик захищеної серверної функції в Supabase
                const { data, error } = await supabaseClient.rpc('admin_initiate_login', {
                    p_username: username,
                    p_password: password,
                    p_ip: clientIp,
                    p_otp_code: otpCode,
                    p_salt: otpSalt
                });

                if (error) {
                    console.error('Server login error:', error);
                    showError('Помилка сервера. Перевірте налаштування бази даних.');
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

                if (data.status === 'otp_created') {
                    currentSessionId = data.session_id;
                    currentLoginUsername = data.username || username;

                    // Відправка одноразового 2FA коду в Telegram
                    const tgText = `🔐 *ВХІД В АДМІН-ПАНЕЛЬ*\n\n` +
                        `👤 *Користувач:* ${currentLoginUsername}\n` +
                        `🔑 *Одноразовий код 2FA*: \`${otpCode}\`\n\n` +
                        `⏳ Код дійсний 3 хвилини. Залишилось спроб введення: 3.`;

                    try {
                        await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                chat_id: TELEGRAM_CHAT_ID,
                                text: tgText,
                                parse_mode: 'Markdown'
                            })
                        });
                    } catch (tgErr) {
                        console.error('Telegram notification error:', tgErr);
                    }

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
                // Атомарний виклик перевірки OTP в Supabase
                const { data, error } = await supabaseClient.rpc('admin_verify_otp', {
                    p_session_id: currentSessionId,
                    p_otp_code: otpDigits
                });

                if (error) {
                    console.error('Verify OTP error:', error);
                    showError('Помилка перевірки коду на сервері.');
                    verifyBtn.disabled = false;
                    verifyBtn.innerHTML = 'Підтвердити вхід';
                    return;
                }

                if (data.status === 'session_expired_or_exhausted') {
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

                if (data.status === 'success') {
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
                        window.location.href = 'dashboard.html';
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

function initDashboard() {
    // Ім'я адміністратора в сайдбарі
    const userLabel = document.getElementById('admin-username-label');
    if (userLabel) userLabel.textContent = 'Користувач: ' + currentUser;

    // Перемикання розділів меню
    const menuItems = document.querySelectorAll('.menu-item[data-section]');
    menuItems.forEach(item => {
        item.addEventListener('click', () => {
            menuItems.forEach(mi => mi.classList.remove('active'));
            item.classList.add('active');

            document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
            const target = document.getElementById(item.dataset.section);
            if (target) target.classList.add('active');
        });
    });

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

        updateStats();
        renderRecentBookings();
        renderBookings();
        renderCottages();
        renderClients();
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

async function deleteBooking(id) {
    if (!window.confirm('Видалити це бронювання?')) return;

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

    grid.innerHTML = allCottages.map(c => `
        <div class="cottage-card">
            <div class="cottage-card-top">
                <div>
                    <div class="cottage-card-title">${escapeHtml(c.name)}</div>
                    <div class="cottage-card-meta">
                        Гостей: ${c.guest_count || '—'} • Номери: ${escapeHtml(c.cottage_numbers || '—')}<br>
                        Поверхів: ${c.floors || '—'} • Спалень: ${c.bedrooms || '—'}
                    </div>
                </div>
                <span class="badge ${c.status === 'active' ? 'badge-active' : 'badge-inactive'}">
                    ${c.status === 'active' ? 'Активний' : 'Неактивний'}
                </span>
            </div>
            <div class="cottage-card-price">${Number(c.price || 0).toLocaleString('uk-UA')} ₴ / ніч</div>
            ${c.description ? `<div class="cottage-card-meta">${escapeHtml(c.description)}</div>` : ''}
            <div class="cottage-card-actions">
                <button class="btn-sm btn-edit" onclick="editCottage('${c.id}')">Редагувати</button>
                <button class="btn-sm btn-delete" onclick="deleteCottage('${c.id}')">Видалити</button>
            </div>
        </div>
    `).join('');
}

function openCottageModal(id) {
    const c = id ? allCottages.find(x => x.id === id) : null;

    document.getElementById('modal-cottage-title').textContent = c ? 'Редагувати котедж' : 'Додати котедж';
    document.getElementById('cottage-id').value = c ? c.id : '';
    document.getElementById('c-name').value = c ? (c.name || '') : '';
    document.getElementById('c-guests').value = c ? (c.guest_count || 1) : '';
    document.getElementById('c-numbers').value = c ? (c.cottage_numbers || '') : '';
    document.getElementById('c-floors').value = c ? (c.floors || 1) : '';
    document.getElementById('c-bedrooms').value = c ? (c.bedrooms || 1) : '';
    document.getElementById('c-price').value = c ? (c.price || '') : '';
    document.getElementById('c-status').value = c ? (c.status || 'active') : 'active';
    document.getElementById('c-description').value = c ? (c.description || '') : '';

    openModal('modal-cottage');
}

function editCottage(id) {
    openCottageModal(id);
}

async function saveCottage() {
    const payload = {
        id: document.getElementById('cottage-id').value,
        name: document.getElementById('c-name').value.trim(),
        guest_count: parseInt(document.getElementById('c-guests').value, 10) || 1,
        cottage_numbers: document.getElementById('c-numbers').value.trim(),
        floors: parseInt(document.getElementById('c-floors').value, 10) || 1,
        bedrooms: parseInt(document.getElementById('c-bedrooms').value, 10) || 1,
        price: parseFloat(document.getElementById('c-price').value) || 0,
        status: document.getElementById('c-status').value,
        description: document.getElementById('c-description').value.trim()
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
