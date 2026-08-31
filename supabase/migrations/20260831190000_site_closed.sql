-- ============================================================================
-- РЕЖИМ "САЙТ ЗАКРИТО": публічне бронювання вимикається повністю
-- ===========================================================================

-- Ключі стану та повідомлення
INSERT INTO site_settings (key, value) VALUES
(
    'site_closed',
    'false'
),
(
    'site_closed_message',
    'На даний момент сайт закритий. Зателефонуйте нам або напишіть у Telegram — і ми оформимо бронювання особисто.'
)
ON CONFLICT (key) DO NOTHING;

-- create_booking: при закритому сайті відхиляємо НА РІВНІ API,
-- фронтенд обійти неможливо
CREATE OR REPLACE FUNCTION create_booking(p_data JSONB, p_identifier TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_name TEXT;
    v_phone TEXT;
    v_checkin DATE;
    v_checkout DATE;
    v_adults INT;
    v_children INT;
    v_cottage_id UUID;
    v_notes TEXT;
    v_nights INT;
    v_hits INT;
    v_id UUID;
    v_closed TEXT;
    v_closed_msg TEXT;
BEGIN
    -- Режим "сайт закрито": публічне створення бронювань заблоковане
    SELECT value INTO v_closed FROM site_settings WHERE key = 'site_closed';
    IF v_closed = 'true' THEN
        SELECT value INTO v_closed_msg FROM site_settings WHERE key = 'site_closed_message';
        RETURN jsonb_build_object(
            'status', 'site_closed',
            'message', COALESCE(v_closed_msg, 'На даний момент сайт закритий.')
        );
    END IF;

    -- Rate limit: не більше 10 бронювань на годину з одного ідентифікатора
    INSERT INTO booking_rate_limit (identifier, hits, window_start)
    VALUES (COALESCE(NULLIF(p_identifier, ''), 'unknown'), 1, NOW())
    ON CONFLICT (identifier) DO UPDATE SET
        hits = CASE
            WHEN booking_rate_limit.window_start < NOW() - INTERVAL '1 hour' THEN 1
            ELSE booking_rate_limit.hits + 1
        END,
        window_start = CASE
            WHEN booking_rate_limit.window_start < NOW() - INTERVAL '1 hour' THEN NOW()
            ELSE booking_rate_limit.window_start
        END
    RETURNING hits INTO v_hits;

    IF v_hits > 10 THEN
        RETURN jsonb_build_object('status', 'rate_limited');
    END IF;

    -- Валідація полів
    v_name      := LEFT(NULLIF(TRIM(p_data->>'guest_name'), ''), 100);
    v_phone     := LEFT(NULLIF(TRIM(p_data->>'guest_phone'), ''), 25);
    v_checkin   := (p_data->>'check_in')::DATE;
    v_checkout  := (p_data->>'check_out')::DATE;
    v_adults    := COALESCE((p_data->>'adults_count')::INT, 1);
    v_children  := COALESCE((p_data->>'children_count')::INT, 0);
    v_cottage_id := NULLIF(p_data->>'cottage_id', '')::UUID;
    v_notes     := LEFT(NULLIF(TRIM(p_data->>'notes'), ''), 1000);

    IF v_name IS NULL OR LENGTH(v_name) < 2 THEN
        RETURN jsonb_build_object('status', 'invalid', 'message', 'Вкажіть ім''я гостя');
    END IF;

    IF v_phone IS NULL OR v_phone !~ '^[+0-9()\s-]{7,25}$' THEN
        RETURN jsonb_build_object('status', 'invalid', 'message', 'Некоректний номер телефону');
    END IF;

    IF v_checkin IS NULL OR v_checkout IS NULL OR v_checkin < CURRENT_DATE THEN
        RETURN jsonb_build_object('status', 'invalid', 'message', 'Некоректні дати заїзду');
    END IF;

    v_nights := (v_checkout - v_checkin);
    IF v_nights < 1 OR v_nights > 60 THEN
        RETURN jsonb_build_object('status', 'invalid', 'message', 'Некоректний термін проживання');
    END IF;

    IF v_adults < 1 OR v_adults > 20 OR v_children < 0 OR v_children > 20 THEN
        RETURN jsonb_build_object('status', 'invalid', 'message', 'Некоректна кількість гостей');
    END IF;

    IF v_cottage_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM cottages WHERE id = v_cottage_id) THEN
        RETURN jsonb_build_object('status', 'invalid', 'message', 'Котедж не знайдено');
    END IF;

    INSERT INTO bookings (
        check_in, check_out, guest_name, guest_phone,
        adults_count, children_count, cottage_id, status, notes
    ) VALUES (
        v_checkin, v_checkout, v_name, v_phone,
        v_adults, v_children, v_cottage_id, 'pending', v_notes
    )
    RETURNING id INTO v_id;

    RETURN jsonb_build_object('status', 'ok', 'id', v_id);
END;
$$;
