-- ============================================================================
-- ПІДГОТОВКА ДО ПУБЛІКАЦІЇ: ЗАТИРКАННЯ БЕЗПЕКИ
-- 1) Бронювання лише через RPC з валідацією та rate-limit (спам-захист)
-- 2) Промокоди перевіряються через RPC, публічне читання таблиці закрите
-- 3) Telegram-сповіщення надсилає тригер БД (токен у vault, не у фронтенді)
-- ============================================================================

-- 0. Прибираємо тестові бронювання, створені під час перевірок
DELETE FROM bookings WHERE guest_name IN ('SECURITY-TEST', 'Автотест Перевірка');

-- ============================================================================
-- 1. RATE-LIMIT ДЛЯ ПУБЛІЧНОГО СТВОРЕННЯ БРОНЮВАНЬ
-- ============================================================================
CREATE TABLE IF NOT EXISTS booking_rate_limit (
    identifier TEXT PRIMARY KEY,
    hits INTEGER NOT NULL DEFAULT 0,
    window_start TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE booking_rate_limit ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Deny all public booking_rate_limit" ON booking_rate_limit;
CREATE POLICY "Deny all public booking_rate_limit" ON booking_rate_limit
    FOR ALL TO public USING (false);

-- ============================================================================
-- 2. RPC СТВОРЕННЯ БРОНЮВАННЯ (єдина точка входу для публіки)
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
BEGIN
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

    -- Статус завжди pending; ціну й підтвердження визначає адмін
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

-- ============================================================================
-- 3. RPC ПЕРЕВІРКИ ПРОМОКОДУ (замість публічного читання таблиці)
-- ============================================================================
CREATE OR REPLACE FUNCTION validate_promo_code(p_code TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_promo promo_codes%ROWTYPE;
BEGIN
    SELECT * INTO v_promo
    FROM promo_codes
    WHERE UPPER(TRIM(code)) = UPPER(TRIM(p_code))
      AND active
      AND (valid_from IS NULL OR valid_from <= NOW())
      AND (valid_until IS NULL OR valid_until >= NOW())
      AND (max_uses IS NULL OR current_uses < max_uses);

    IF NOT FOUND THEN
        RETURN jsonb_build_object('status', 'not_found');
    END IF;

    -- Зараховуємо використання одразу при успішній перевірці
    UPDATE promo_codes
    SET current_uses = COALESCE(current_uses, 0) + 1
    WHERE id = v_promo.id;

    RETURN jsonb_build_object(
        'status', 'ok',
        'code', v_promo.code,
        'discount', v_promo.discount
    );
END;
$$;

-- ============================================================================
-- 4. ЗАКРИВАЄМО ПУБЛІЧНИЙ ДОСТУП ДО ТАБЛИЦЬ
-- ============================================================================
-- Бронювання можна створювати ТІЛЬКИ через create_booking
DROP POLICY IF EXISTS "Public can create bookings" ON bookings;

-- Промокоди публічно не читаються (тільки validate_promo_code)
DROP POLICY IF EXISTS "Allow public read access promo" ON promo_codes;
DROP POLICY IF EXISTS "Public can read promo codes" ON promo_codes;

-- ============================================================================
-- 5. TELEGRAM-СПОВІЩЕННЯ ЧЕРЕЗ ТРИГЕР БД (токен у vault)
-- ============================================================================
CREATE EXTENSION IF NOT EXISTS pg_net;
CREATE EXTENSION IF NOT EXISTS supabase_vault;

-- Токен і чат зберігаються у vault; секрети створюються лише якщо їх ще нема
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'telegram_bot_token') THEN
        PERFORM vault.create_secret('8845339263:AAEyY_6gw1xQyJjqBOQ2kxp8tECYoWC2oRE', 'telegram_bot_token');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'telegram_chat_id') THEN
        PERFORM vault.create_secret('2026196111', 'telegram_chat_id');
    END IF;
END $$;

CREATE OR REPLACE FUNCTION notify_booking_telegram()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_token TEXT;
    v_chat TEXT;
    v_text TEXT;
    v_cottage TEXT;
BEGIN
    SELECT decrypted_secret INTO v_token FROM vault.decrypted_secrets WHERE name = 'telegram_bot_token';
    SELECT decrypted_secret INTO v_chat FROM vault.decrypted_secrets WHERE name = 'telegram_chat_id';
    IF v_token IS NULL OR v_chat IS NULL THEN
        RETURN NEW;
    END IF;

    SELECT name INTO v_cottage FROM cottages WHERE id = NEW.cottage_id;

    v_text := '🏡 *НОВЕ БРОНЮВАННЯ*' || chr(10) || chr(10) ||
        '👤 *Гість:* ' || regexp_replace(NEW.guest_name, '[_*`\[\]]', '', 'g') || chr(10) ||
        '📱 *Телефон:* ' || regexp_replace(NEW.guest_phone, '[_*`\[\]]', '', 'g') || chr(10) ||
        '🏠 *Котедж:* ' || COALESCE(regexp_replace(v_cottage, '[_*`\[\]]', '', 'g'), '—') || chr(10) ||
        '📅 *Заїзд:* ' || to_char(NEW.check_in, 'DD.MM.YYYY') || chr(10) ||
        '📅 *Виїзд:* ' || to_char(NEW.check_out, 'DD.MM.YYYY') || chr(10) ||
        '👥 *Гості:* ' || NEW.adults_count || ' дорослих, ' || NEW.children_count || ' дітей' || chr(10) ||
        '⏰ *Час:* ' || to_char(NOW(), 'DD.MM.YYYY HH24:MI');

    PERFORM net.http_post(
        url := 'https://api.telegram.org/bot' || v_token || '/sendMessage',
        body := jsonb_build_object(
            'chat_id', v_chat,
            'text', v_text,
            'parse_mode', 'Markdown'
        ),
        headers := '{"Content-Type": "application/json"}'::jsonb
    );

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_booking_telegram ON bookings;
CREATE TRIGGER trg_notify_booking_telegram
    AFTER INSERT ON bookings
    FOR EACH ROW
    EXECUTE FUNCTION notify_booking_telegram();
