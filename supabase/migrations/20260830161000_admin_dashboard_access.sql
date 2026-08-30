-- ============================================================================
-- АДМІН-ДАШБОРД: серверні сесії + RPC доступ до даних
-- Дашборд читає/пише bookings та cottages через SECURITY DEFINER функції,
-- щоб не послаблювати RLS-політики для anon-ключа.
-- ============================================================================

-- 1. Таблиця серверних сесій адміністратора (токен видає сервер)
CREATE TABLE IF NOT EXISTS admin_sessions (
    token TEXT PRIMARY KEY,
    user_id UUID REFERENCES admin_users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL
);

ALTER TABLE admin_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Deny all public admin_sessions" ON admin_sessions;
CREATE POLICY "Deny all public admin_sessions" ON admin_sessions
    FOR ALL TO public USING (false);

-- 2. Оновлена admin_verify_otp: тепер видає серверний токен сесії (2 години)
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
    v_token TEXT;
BEGIN
    -- АТОМАРНИЙ ДЕКРЕМЕНТ: зменшує attempts_left і блокує рядок в одній операції
    UPDATE admin_otp_sessions
    SET attempts_left = attempts_left - 1
    WHERE id = p_session_id
      AND attempts_left > 0
      AND expires_at > NOW()
      AND NOT consumed
    RETURNING * INTO v_session;

    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'status', 'session_expired_or_exhausted',
            'message', 'Сесія OTP недійсна, вичерпана або закінчився час дії (3 хв).'
        );
    END IF;

    v_computed_hash := encode(digest(p_otp_code || v_session.salt, 'sha256'), 'hex');

    IF v_computed_hash = v_session.otp_hash THEN
        UPDATE admin_otp_sessions
        SET consumed = true, attempts_left = 0
        WHERE id = p_session_id;

        -- Прибираємо прострочені сесії
        DELETE FROM admin_sessions WHERE expires_at < NOW();

        -- Створюємо серверну сесію на 2 години
        INSERT INTO admin_sessions (token, user_id, expires_at)
        VALUES (
            encode(gen_random_bytes(32), 'hex'),
            v_session.user_id,
            NOW() + INTERVAL '2 hours'
        )
        RETURNING token INTO v_token;

        RETURN jsonb_build_object(
            'status', 'success',
            'user_id', v_session.user_id,
            'session_token', v_token
        );
    ELSE
        RETURN jsonb_build_object(
            'status', 'invalid_otp',
            'attempts_left', v_session.attempts_left
        );
    END IF;
END;
$$;

-- 3. Дані для дашборда: всі бронювання + всі котеджі
CREATE OR REPLACE FUNCTION admin_get_dashboard(p_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    UPDATE admin_sessions
    SET expires_at = NOW() + INTERVAL '2 hours'
    WHERE token = p_token AND expires_at > NOW();

    IF NOT FOUND THEN
        RETURN jsonb_build_object('status', 'unauthorized');
    END IF;

    RETURN jsonb_build_object(
        'status', 'ok',
        'bookings', (
            SELECT COALESCE(jsonb_agg(to_jsonb(b) ORDER BY b.created_at DESC), '[]'::jsonb)
            FROM bookings b
        ),
        'cottages', (
            SELECT COALESCE(jsonb_agg(to_jsonb(c) ORDER BY c.created_at DESC), '[]'::jsonb)
            FROM cottages c
        )
    );
END;
$$;

-- 4. Створення/оновлення бронювання
CREATE OR REPLACE FUNCTION admin_save_booking(p_token TEXT, p_data JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_id UUID;
BEGIN
    UPDATE admin_sessions
    SET expires_at = NOW() + INTERVAL '2 hours'
    WHERE token = p_token AND expires_at > NOW();

    IF NOT FOUND THEN
        RETURN jsonb_build_object('status', 'unauthorized');
    END IF;

    v_id := NULLIF(p_data->>'id', '')::UUID;

    IF v_id IS NULL THEN
        INSERT INTO bookings (
            check_in, check_out, guest_name, guest_phone,
            adults_count, children_count, cottage_id, status, notes, updated_at
        ) VALUES (
            (p_data->>'check_in')::DATE,
            (p_data->>'check_out')::DATE,
            p_data->>'guest_name',
            p_data->>'guest_phone',
            COALESCE((p_data->>'adults_count')::INT, 1),
            COALESCE((p_data->>'children_count')::INT, 0),
            NULLIF(p_data->>'cottage_id', '')::UUID,
            COALESCE(NULLIF(p_data->>'status', ''), 'pending'),
            NULLIF(p_data->>'notes', ''),
            NOW()
        )
        RETURNING id INTO v_id;
    ELSE
        UPDATE bookings SET
            check_in = (p_data->>'check_in')::DATE,
            check_out = (p_data->>'check_out')::DATE,
            guest_name = p_data->>'guest_name',
            guest_phone = p_data->>'guest_phone',
            adults_count = COALESCE((p_data->>'adults_count')::INT, 1),
            children_count = COALESCE((p_data->>'children_count')::INT, 0),
            cottage_id = NULLIF(p_data->>'cottage_id', '')::UUID,
            status = COALESCE(NULLIF(p_data->>'status', ''), 'pending'),
            notes = NULLIF(p_data->>'notes', ''),
            updated_at = NOW()
        WHERE id = v_id
        RETURNING id INTO v_id;

        IF NOT FOUND THEN
            RETURN jsonb_build_object('status', 'not_found');
        END IF;
    END IF;

    RETURN jsonb_build_object('status', 'ok', 'id', v_id);
END;
$$;

-- 5. Видалення бронювання
CREATE OR REPLACE FUNCTION admin_delete_booking(p_token TEXT, p_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    UPDATE admin_sessions
    SET expires_at = NOW() + INTERVAL '2 hours'
    WHERE token = p_token AND expires_at > NOW();

    IF NOT FOUND THEN
        RETURN jsonb_build_object('status', 'unauthorized');
    END IF;

    DELETE FROM bookings WHERE id = p_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('status', 'not_found');
    END IF;

    RETURN jsonb_build_object('status', 'ok');
END;
$$;

-- 6. Створення/оновлення котеджу
CREATE OR REPLACE FUNCTION admin_save_cottage(p_token TEXT, p_data JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_id UUID;
BEGIN
    UPDATE admin_sessions
    SET expires_at = NOW() + INTERVAL '2 hours'
    WHERE token = p_token AND expires_at > NOW();

    IF NOT FOUND THEN
        RETURN jsonb_build_object('status', 'unauthorized');
    END IF;

    v_id := NULLIF(p_data->>'id', '')::UUID;

    IF v_id IS NULL THEN
        INSERT INTO cottages (
            name, guest_count, cottage_numbers, floors, bedrooms,
            price, tariff, status, description, updated_at
        ) VALUES (
            p_data->>'name',
            COALESCE((p_data->>'guest_count')::INT, 1),
            COALESCE(NULLIF(p_data->>'cottage_numbers', ''), '1'),
            COALESCE((p_data->>'floors')::INT, 1),
            COALESCE((p_data->>'bedrooms')::INT, 1),
            COALESCE((p_data->>'price')::NUMERIC, 0),
            NULLIF(p_data->>'tariff', ''),
            COALESCE(NULLIF(p_data->>'status', ''), 'active'),
            COALESCE(NULLIF(p_data->>'description', ''), ''),
            NOW()
        )
        RETURNING id INTO v_id;
    ELSE
        UPDATE cottages SET
            name = p_data->>'name',
            guest_count = COALESCE((p_data->>'guest_count')::INT, 1),
            cottage_numbers = COALESCE(NULLIF(p_data->>'cottage_numbers', ''), '1'),
            floors = COALESCE((p_data->>'floors')::INT, 1),
            bedrooms = COALESCE((p_data->>'bedrooms')::INT, 1),
            price = COALESCE((p_data->>'price')::NUMERIC, 0),
            tariff = NULLIF(p_data->>'tariff', ''),
            status = COALESCE(NULLIF(p_data->>'status', ''), 'active'),
            description = COALESCE(NULLIF(p_data->>'description', ''), ''),
            updated_at = NOW()
        WHERE id = v_id
        RETURNING id INTO v_id;

        IF NOT FOUND THEN
            RETURN jsonb_build_object('status', 'not_found');
        END IF;
    END IF;

    RETURN jsonb_build_object('status', 'ok', 'id', v_id);
END;
$$;

-- 7. Видалення котеджу
CREATE OR REPLACE FUNCTION admin_delete_cottage(p_token TEXT, p_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    UPDATE admin_sessions
    SET expires_at = NOW() + INTERVAL '2 hours'
    WHERE token = p_token AND expires_at > NOW();

    IF NOT FOUND THEN
        RETURN jsonb_build_object('status', 'unauthorized');
    END IF;

    DELETE FROM cottages WHERE id = p_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('status', 'not_found');
    END IF;

    RETURN jsonb_build_object('status', 'ok');
END;
$$;

-- 8. Вихід: видаляємо серверну сесію
CREATE OR REPLACE FUNCTION admin_logout(p_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    DELETE FROM admin_sessions WHERE token = p_token;
    RETURN jsonb_build_object('status', 'ok');
END;
$$;
