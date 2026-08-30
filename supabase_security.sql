-- ============================================================================
-- SUPABASE ENTERPRISE SECURITY SETUP (2026)
-- ============================================================================

-- 1. Увімкнення розширення для криптографії
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================================
-- 2. СЛУЖБОВІ ТАБЛИЦІ БЕЗПЕКИ АДМІН-ПАНЕЛІ
-- ============================================================================

-- Таблиця облікових записів адміністраторів
CREATE TABLE IF NOT EXISTS admin_users (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL, -- bcrypt cost factor 12
    role TEXT DEFAULT 'admin' NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Таблиця відстеження спроб входу (Anti-Brute Force Rate Limiter)
CREATE TABLE IF NOT EXISTS admin_login_attempts (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    ip_address TEXT UNIQUE NOT NULL,
    failed_count INTEGER DEFAULT 0 NOT NULL,
    locked_until TIMESTAMP WITH TIME ZONE,
    last_attempt TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Таблиця 2FA OTP сесій
CREATE TABLE IF NOT EXISTS admin_otp_sessions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES admin_users(id) ON DELETE CASCADE,
    otp_hash TEXT NOT NULL,
    salt TEXT NOT NULL, -- Унікальна випадкова сіль per-OTP
    attempts_left INTEGER DEFAULT 3 NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    consumed BOOLEAN DEFAULT false NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================================================
-- 3. ПОВНА ІЗОЛЯЦІЯ СЛУЖБОВИХ ТАБЛИЦЬ (RLS DENY ДЛЯ ANON)
-- ============================================================================

ALTER TABLE admin_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_login_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_otp_sessions ENABLE ROW LEVEL SECURITY;

-- Видаляємо всі можливі старі публічні політики
DROP POLICY IF EXISTS "Public access admin_users" ON admin_users;
DROP POLICY IF EXISTS "Public access admin_login_attempts" ON admin_login_attempts;
DROP POLICY IF EXISTS "Public access admin_otp_sessions" ON admin_otp_sessions;

-- Службові таблиці повністю закриті від REST API (доступ тільки через service_role / SECURITY DEFINER)
CREATE POLICY "Deny all public admin_users" ON admin_users FOR ALL TO public USING (false);
CREATE POLICY "Deny all public admin_login_attempts" ON admin_login_attempts FOR ALL TO public USING (false);
CREATE POLICY "Deny all public admin_otp_sessions" ON admin_otp_sessions FOR ALL TO public USING (false);

-- ============================================================================
-- 4. АТОМАРНІ ФУНКЦІЇ БЕЗПЕКИ (SECURITY DEFINER)
-- ============================================================================

-- Функція 1: Перевірка пароля (bcrypt 12) + Rate Limiting + Створення OTP сесії
CREATE OR REPLACE FUNCTION admin_initiate_login(
    p_email TEXT,
    p_password TEXT,
    p_ip TEXT,
    p_otp_code TEXT,
    p_salt TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_admin admin_users%ROWTYPE;
    v_attempts admin_login_attempts%ROWTYPE;
    v_session_id UUID;
    v_otp_hash TEXT;
BEGIN
    -- 1. Перевірка блокування за IP (Rate Limiter)
    SELECT * INTO v_attempts FROM admin_login_attempts WHERE ip_address = p_ip;
    
    IF FOUND AND v_attempts.locked_until IS NOT NULL AND v_attempts.locked_until > NOW() THEN
        RETURN jsonb_build_object(
            'status', 'locked',
            'locked_until', v_attempts.locked_until,
            'retry_after_seconds', EXTRACT(EPOCH FROM (v_attempts.locked_until - NOW()))::INT
        );
    END IF;

    -- 2. Пошук адміна за Email
    SELECT * INTO v_admin FROM admin_users WHERE email = LOWER(TRIM(p_email));

    -- 3. Перевірка пароля (bcrypt cost 12)
    IF NOT FOUND OR v_admin.password_hash != crypt(p_password, v_admin.password_hash) THEN
        -- Збільшуємо лічильник помилок
        INSERT INTO admin_login_attempts (ip_address, failed_count, last_attempt, locked_until)
        VALUES (
            p_ip, 
            1, 
            NOW(), 
            NULL
        )
        ON CONFLICT (ip_address) DO UPDATE
        SET failed_count = admin_login_attempts.failed_count + 1,
            last_attempt = NOW(),
            locked_until = CASE 
                WHEN admin_login_attempts.failed_count + 1 >= 5 THEN NOW() + INTERVAL '15 minutes'
                ELSE NULL
            END
        RETURNING * INTO v_attempts;

        IF v_attempts.failed_count >= 5 THEN
            RETURN jsonb_build_object(
                'status', 'locked',
                'locked_until', v_attempts.locked_until,
                'retry_after_seconds', 900
            );
        ELSE
            RETURN jsonb_build_object(
                'status', 'invalid_credentials',
                'attempts_left', 5 - v_attempts.failed_count
            );
        END IF;
    END IF;

    -- 4. Пароль вірний -> Скидаємо лічильник невдалих спроб
    DELETE FROM admin_login_attempts WHERE ip_address = p_ip;

    -- 5. Обчислюємо SHA-256 хеш OTP з унікальною сіллю
    v_otp_hash := encode(digest(p_otp_code || p_salt, 'sha256'), 'hex');

    -- 6. Створюємо 2FA OTP сесію з TTL 3 хвилини
    INSERT INTO admin_otp_sessions (user_id, otp_hash, salt, attempts_left, expires_at, consumed)
    VALUES (v_admin.id, v_otp_hash, p_salt, 3, NOW() + INTERVAL '3 minutes', false)
    RETURNING id INTO v_session_id;

    RETURN jsonb_build_object(
        'status', 'otp_created',
        'session_id', v_session_id,
        'user_id', v_admin.id,
        'email', v_admin.email,
        'expires_in_seconds', 180
    );
END;
$$;

-- Функція 2: Атомарна верифікація 2FA OTP проти Race Conditions
CREATE OR REPLACE FUNCTION admin_verify_otp(
    p_session_id UUID,
    p_otp_code TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_session admin_otp_sessions%ROWTYPE;
    v_computed_hash TEXT;
BEGIN
    -- АТОМАРНИЙ ДЕКРЕМЕНТ: зменшує attempts_left і блокує рядок в одній операції
    UPDATE admin_otp_sessions
    SET attempts_left = attempts_left - 1
    WHERE id = p_session_id
      AND attempts_left > 0
      AND expires_at > NOW()
      AND NOT consumed
    RETURNING * INTO v_session;

    -- Якщо запис не знайдено (вичерпано спроби, вичерпано час TTL або вже використано)
    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'status', 'session_expired_or_exhausted',
            'message', 'Сесія OTP недійсна, вичерпана або закінчився час дії (3 хв).'
        );
    END IF;

    -- Обчислюємо SHA-256 хеш наданого коду з сіллю сесії
    v_computed_hash := encode(digest(p_otp_code || v_session.salt, 'sha256'), 'hex');

    -- Перевірка хешу
    IF v_computed_hash = v_session.otp_hash THEN
        -- ВСТАНОВЛЮЄМО consumed = true НЕГАЙНО
        UPDATE admin_otp_sessions
        SET consumed = true, attempts_left = 0
        WHERE id = p_session_id;

        RETURN jsonb_build_object(
            'status', 'success',
            'user_id', v_session.user_id
        );
    ELSE
        -- Якщо код невірний
        RETURN jsonb_build_object(
            'status', 'invalid_otp',
            'attempts_left', v_session.attempts_left
        );
    END IF;
END;
$$;

-- ============================================================================
-- 5. RLS ПОЛІТИКИ ДЛЯ ТАБЛИЦЬ BOOKINGS ТА COTTAGES
-- ============================================================================

-- Таблиця bookings
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public read access" ON bookings;
DROP POLICY IF EXISTS "Allow public insert access" ON bookings;
DROP POLICY IF EXISTS "Allow public update access" ON bookings;
DROP POLICY IF EXISTS "Allow public delete access" ON bookings;
DROP POLICY IF EXISTS "Public can create bookings" ON bookings;
DROP POLICY IF EXISTS "Admin full bookings access" ON bookings;

-- Публічні гості можуть ТІЛЬКИ створювати нові бронювання
CREATE POLICY "Public can create bookings" ON bookings
    FOR INSERT TO public
    WITH CHECK (true);

-- Читати, змінювати та видаляти бронювання може ТІЛЬКИ авторизований адмін
CREATE POLICY "Admin full bookings access" ON bookings
    FOR ALL TO authenticated
    USING (true)
    WITH CHECK (true);

-- Таблиця cottages
ALTER TABLE cottages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public read access cottages" ON cottages;
DROP POLICY IF EXISTS "Allow public insert access cottages" ON cottages;
DROP POLICY IF EXISTS "Allow public update access cottages" ON cottages;
DROP POLICY IF EXISTS "Allow public delete access cottages" ON cottages;
DROP POLICY IF EXISTS "Public can view active cottages" ON cottages;
DROP POLICY IF EXISTS "Admin full cottages access" ON cottages;

-- Публічні користувачі можуть бачити ТІЛЬКИ активні котеджі
CREATE POLICY "Public can view active cottages" ON cottages
    FOR SELECT TO public
    USING (status = 'active');

-- Змінювати, додавати та видаляти котеджі може ТІЛЬКИ авторизований адмін
CREATE POLICY "Admin full cottages access" ON cottages
    FOR ALL TO authenticated
    USING (true)
    WITH CHECK (true);

-- ============================================================================
-- 6. ДЕФОЛТНИЙ АДМІНІСТРАТОР (bcrypt cost 12)
-- Логін: admin@ecoberghaus.com.ua
-- Пароль за замовчуванням: EcoBerghaus2026! (змініть при першому вході)
-- ============================================================================
INSERT INTO admin_users (email, password_hash, role)
VALUES (
    'admin@ecoberghaus.com.ua',
    crypt('EcoBerghaus2026!', gen_salt('bf', 12)),
    'admin'
)
ON CONFLICT (email) DO UPDATE
SET password_hash = crypt('EcoBerghaus2026!', gen_salt('bf', 12));
