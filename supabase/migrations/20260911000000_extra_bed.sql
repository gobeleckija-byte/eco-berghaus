-- ============================================================================
-- Додаткове місце: налаштування котеджу та фіксація ціни у бронюванні
-- ============================================================================

ALTER TABLE cottages
    ADD COLUMN IF NOT EXISTS extra_bed_enabled BOOLEAN,
    ADD COLUMN IF NOT EXISTS extra_bed_price NUMERIC(12, 2);

UPDATE cottages
SET
    extra_bed_enabled = COALESCE(extra_bed_enabled, FALSE),
    extra_bed_price = COALESCE(extra_bed_price, 0);

ALTER TABLE cottages
    ALTER COLUMN extra_bed_enabled SET DEFAULT FALSE,
    ALTER COLUMN extra_bed_enabled SET NOT NULL,
    ALTER COLUMN extra_bed_price SET DEFAULT 0,
    ALTER COLUMN extra_bed_price SET NOT NULL;

ALTER TABLE bookings
    ADD COLUMN IF NOT EXISTS base_price NUMERIC(12, 2),
    ADD COLUMN IF NOT EXISTS extra_bed_selected BOOLEAN,
    ADD COLUMN IF NOT EXISTS extra_bed_price NUMERIC(12, 2),
    ADD COLUMN IF NOT EXISTS discount_percent NUMERIC(5, 2),
    ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(12, 2),
    ADD COLUMN IF NOT EXISTS total_price NUMERIC(12, 2);

UPDATE bookings
SET
    base_price = COALESCE(base_price, 0),
    extra_bed_selected = COALESCE(extra_bed_selected, FALSE),
    extra_bed_price = COALESCE(extra_bed_price, 0),
    discount_percent = COALESCE(discount_percent, 0),
    discount_amount = COALESCE(discount_amount, 0),
    total_price = COALESCE(total_price, 0);

ALTER TABLE bookings
    ALTER COLUMN base_price SET DEFAULT 0,
    ALTER COLUMN base_price SET NOT NULL,
    ALTER COLUMN extra_bed_selected SET DEFAULT FALSE,
    ALTER COLUMN extra_bed_selected SET NOT NULL,
    ALTER COLUMN extra_bed_price SET DEFAULT 0,
    ALTER COLUMN extra_bed_price SET NOT NULL,
    ALTER COLUMN discount_percent SET DEFAULT 0,
    ALTER COLUMN discount_percent SET NOT NULL,
    ALTER COLUMN discount_amount SET DEFAULT 0,
    ALTER COLUMN discount_amount SET NOT NULL,
    ALTER COLUMN total_price SET DEFAULT 0,
    ALTER COLUMN total_price SET NOT NULL;

-- ============================================================================
-- admin_save_cottage: зберігає доступність і ціну додаткового місця
-- ============================================================================
CREATE OR REPLACE FUNCTION admin_save_cottage(p_token TEXT, p_data JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_id UUID;
    v_photos TEXT;
    v_extra_bed_enabled BOOLEAN;
    v_extra_bed_price NUMERIC(12, 2);
BEGIN
    UPDATE admin_sessions
    SET expires_at = NOW() + INTERVAL '2 hours'
    WHERE token = p_token AND expires_at > NOW();

    IF NOT FOUND THEN
        RETURN jsonb_build_object('status', 'unauthorized');
    END IF;

    v_id := NULLIF(p_data->>'id', '')::UUID;
    v_photos := NULLIF(TRIM(p_data->>'photos'), '');
    v_extra_bed_enabled := COALESCE((p_data->>'extra_bed_enabled')::BOOLEAN, FALSE);
    v_extra_bed_price := GREATEST(COALESCE((p_data->>'extra_bed_price')::NUMERIC, 0), 0);

    IF v_id IS NULL THEN
        INSERT INTO cottages (
            name, guest_count, cottage_numbers, floors, bedrooms,
            price, tariff, status, description, photos,
            extra_bed_enabled, extra_bed_price, updated_at
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
            v_photos,
            v_extra_bed_enabled,
            v_extra_bed_price,
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
            photos = v_photos,
            extra_bed_enabled = v_extra_bed_enabled,
            extra_bed_price = v_extra_bed_price,
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

-- ============================================================================
-- create_booking: перевіряє місткість і фіксує ціну додаткового місця
-- ============================================================================
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
    v_extra_bed_selected BOOLEAN;
    v_base_price NUMERIC(12, 2) := 0;
    v_extra_bed_price NUMERIC(12, 2) := 0;
    v_discount_percent NUMERIC(5, 2) := 0;
    v_discount_amount NUMERIC(12, 2) := 0;
    v_total_price NUMERIC(12, 2) := 0;
    v_cottage_capacity INT;
    v_allowed_capacity INT;
    v_extra_bed_enabled BOOLEAN;
BEGIN
    SELECT value INTO v_closed FROM site_settings WHERE key = 'site_closed';
    IF v_closed = 'true' THEN
        SELECT value INTO v_closed_msg FROM site_settings WHERE key = 'site_closed_message';
        RETURN jsonb_build_object(
            'status', 'site_closed',
            'message', COALESCE(v_closed_msg, 'На даний момент сайт закритий.')
        );
    END IF;

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

    v_name := LEFT(NULLIF(TRIM(p_data->>'guest_name'), ''), 100);
    v_phone := LEFT(NULLIF(TRIM(p_data->>'guest_phone'), ''), 25);
    v_checkin := (p_data->>'check_in')::DATE;
    v_checkout := (p_data->>'check_out')::DATE;
    v_adults := COALESCE((p_data->>'adults_count')::INT, 1);
    v_children := COALESCE((p_data->>'children_count')::INT, 0);
    v_cottage_id := NULLIF(p_data->>'cottage_id', '')::UUID;
    v_notes := LEFT(NULLIF(TRIM(p_data->>'notes'), ''), 1000);
    v_extra_bed_selected := COALESCE((p_data->>'extra_bed_selected')::BOOLEAN, FALSE);
    v_discount_percent := COALESCE((p_data->>'discount_percent')::NUMERIC, 0);

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

    IF v_discount_percent < 0 OR v_discount_percent > 100 THEN
        RETURN jsonb_build_object('status', 'invalid', 'message', 'Некоректна знижка');
    END IF;

    IF v_cottage_id IS NOT NULL THEN
        SELECT price, guest_count, extra_bed_enabled, extra_bed_price
        INTO v_base_price, v_cottage_capacity, v_extra_bed_enabled, v_extra_bed_price
        FROM cottages
        WHERE id = v_cottage_id AND status = 'active';

        IF NOT FOUND THEN
            RETURN jsonb_build_object('status', 'invalid', 'message', 'Котедж не знайдено або недоступний');
        END IF;

        v_allowed_capacity := v_cottage_capacity;
        IF v_extra_bed_selected THEN
            v_allowed_capacity := v_allowed_capacity + 1;
        END IF;

        IF v_extra_bed_selected AND COALESCE(v_extra_bed_enabled, FALSE) = FALSE THEN
            RETURN jsonb_build_object('status', 'invalid', 'message', 'Додаткове місце недоступне для цього котеджу');
        END IF;

        IF v_adults + v_children > v_allowed_capacity THEN
            RETURN jsonb_build_object('status', 'invalid', 'message', 'Обраний котедж не вміщує вказану кількість гостей');
        END IF;

        IF NOT v_extra_bed_selected THEN
            v_extra_bed_price := 0;
        END IF;
    END IF;

    IF v_cottage_id IS NULL AND v_extra_bed_selected THEN
        RETURN jsonb_build_object('status', 'invalid', 'message', 'Оберіть котедж для додаткового місця');
    END IF;

    v_discount_amount := ROUND(v_base_price * v_discount_percent / 100, 2);
    v_total_price := ROUND(v_base_price - v_discount_amount + v_extra_bed_price, 2);

    INSERT INTO bookings (
        check_in, check_out, guest_name, guest_phone,
        adults_count, children_count, cottage_id, status, notes,
        base_price, extra_bed_selected, extra_bed_price,
        discount_percent, discount_amount, total_price
    ) VALUES (
        v_checkin, v_checkout, v_name, v_phone,
        v_adults, v_children, v_cottage_id, 'pending', v_notes,
        v_base_price, v_extra_bed_selected, v_extra_bed_price,
        v_discount_percent, v_discount_amount, v_total_price
    )
    RETURNING id INTO v_id;

    RETURN jsonb_build_object(
        'status', 'ok',
        'id', v_id,
        'base_price', v_base_price,
        'extra_bed_price', v_extra_bed_price,
        'discount_amount', v_discount_amount,
        'total_price', v_total_price
    );
END;
$$;