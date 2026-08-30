-- ============================================================================
-- Керування промокодами в адмін-панелі (token-gated RPC)
-- ============================================================================

-- Список усіх промокодів
CREATE OR REPLACE FUNCTION admin_get_promos(p_token TEXT)
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
        'promos', (
            SELECT COALESCE(jsonb_agg(to_jsonb(p) ORDER BY p.created_at DESC), '[]'::jsonb)
            FROM promo_codes p
        )
    );
END;
$$;

-- Створення/оновлення промокоду
CREATE OR REPLACE FUNCTION admin_save_promo(p_token TEXT, p_data JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_id UUID;
    v_code TEXT;
    v_exists UUID;
BEGIN
    UPDATE admin_sessions
    SET expires_at = NOW() + INTERVAL '2 hours'
    WHERE token = p_token AND expires_at > NOW();

    IF NOT FOUND THEN
        RETURN jsonb_build_object('status', 'unauthorized');
    END IF;

    v_id := NULLIF(p_data->>'id', '')::UUID;
    v_code := UPPER(TRIM(COALESCE(p_data->>'code', '')));

    IF LENGTH(v_code) < 2 OR LENGTH(v_code) > 40 THEN
        RETURN jsonb_build_object('status', 'invalid', 'message', 'Код має містити 2-40 символів');
    END IF;

    IF COALESCE((p_data->>'discount')::INT, 0) < 1 OR COALESCE((p_data->>'discount')::INT, 0) > 100 THEN
        RETURN jsonb_build_object('status', 'invalid', 'message', 'Знижка має бути від 1 до 100%');
    END IF;

    -- Унікальність коду (крім власного рядка)
    SELECT id INTO v_exists FROM promo_codes WHERE code = v_code AND (v_id IS NULL OR id <> v_id) LIMIT 1;
    IF v_exists IS NOT NULL THEN
        RETURN jsonb_build_object('status', 'invalid', 'message', 'Такий код вже існує');
    END IF;

    IF v_id IS NULL THEN
        INSERT INTO promo_codes (code, discount, active, max_uses, valid_from, valid_until, description)
        VALUES (
            v_code,
            (p_data->>'discount')::INT,
            COALESCE((p_data->>'active')::BOOLEAN, true),
            NULLIF(p_data->>'max_uses', '')::INT,
            NULLIF(p_data->>'valid_from', '')::TIMESTAMPTZ,
            NULLIF(p_data->>'valid_until', '')::TIMESTAMPTZ,
            NULLIF(TRIM(COALESCE(p_data->>'description', '')), '')
        )
        RETURNING id INTO v_id;
    ELSE
        UPDATE promo_codes SET
            code = v_code,
            discount = (p_data->>'discount')::INT,
            active = COALESCE((p_data->>'active')::BOOLEAN, true),
            max_uses = NULLIF(p_data->>'max_uses', '')::INT,
            valid_from = NULLIF(p_data->>'valid_from', '')::TIMESTAMPTZ,
            valid_until = NULLIF(p_data->>'valid_until', '')::TIMESTAMPTZ,
            description = NULLIF(TRIM(COALESCE(p_data->>'description', '')), ''),
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

-- Видалення промокоду
CREATE OR REPLACE FUNCTION admin_delete_promo(p_token TEXT, p_id UUID)
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

    DELETE FROM promo_codes WHERE id = p_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('status', 'not_found');
    END IF;

    RETURN jsonb_build_object('status', 'ok');
END;
$$;
