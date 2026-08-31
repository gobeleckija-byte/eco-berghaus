-- ============================================================================
-- РОЗШИРЕНІ НАЛАШТУВАННЯ САЙТУ ТА КОНТЕНТУ
-- Тарифні умови, тексти модальних вікон, правила проживання, контакти, реквізити
-- ============================================================================

CREATE TABLE IF NOT EXISTS site_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE site_settings ENABLE ROW LEVEL SECURITY;

-- Публічне читання налаштувань сайту
DROP POLICY IF EXISTS "Public read site_settings" ON site_settings;
CREATE POLICY "Public read site_settings" ON site_settings
    FOR SELECT TO public USING (true);

-- Дефолтні значення для всіх блоків сайту
INSERT INTO site_settings (key, value) VALUES
(
    'tariff_includes',
    'Безкоштовне скасування бронювання за 7 днів до заїзду|Сніданок «Шведська лінія» включено у вартість|Безлімітний доступ до басейну та SPA-комплексу Rosa'
),
(
    'cottage_details_footer',
    'Котеджі повністю оснащені усім необхідним для комфортного проживання — вам варто взяти лише особисті речі.|* Додаткове місце в котеджі оплачується окремо.|На території містечка є всі необхідні зручності: ресторан, дитячий та спортивний майданчики, власна парковка, цілодобова охорона, спа-комплекс, а розваги курорту Буковель — всього за 2 км.|До зустрічі в EcoBerghaus! Чекаємо на знайомство з вами 💛'
),
(
    'checkin_time',
    '15:00'
),
(
    'checkout_time',
    '11:00'
),
(
    'min_stay_standard',
    '2'
),
(
    'min_stay_holidays',
    '4'
),
(
    'contact_phone',
    '+38 (067) 000-00-00'
),
(
    'contact_email',
    'booking.depart@gmail.com'
),
(
    'contact_telegram',
    'https://t.me/ecoberghaus'
),
(
    'contact_instagram',
    'https://instagram.com/ecoberghaus'
),
(
    'contact_address',
    'Івано-Франківська область, с. Поляниця, ур. Прелуки, Буковель'
),
(
    'payment_recipient',
    'ФОП EcoBerghaus'
),
(
    'payment_iban',
    'UA000000000000000000000000000'
),
(
    'payment_edrpou',
    '00000000'
),
(
    'payment_purpose',
    'Оплата за проживання у котеджі згідно рахунку'
)
ON CONFLICT (key) DO NOTHING;

-- Отримати всі налаштування (для адміністратора)
CREATE OR REPLACE FUNCTION admin_get_settings(p_token TEXT)
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
        'settings', (
            SELECT COALESCE(jsonb_object_agg(key, value), '{}'::jsonb)
            FROM site_settings
        )
    );
END;
$$;

-- Зберегти одне налаштування з UPSERT (key -> value)
CREATE OR REPLACE FUNCTION admin_save_setting(p_token TEXT, p_key TEXT, p_value TEXT)
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

    IF p_key IS NULL OR LENGTH(TRIM(p_key)) = 0 THEN
        RETURN jsonb_build_object('status', 'invalid', 'message', 'Ключ налаштування не може бути порожнім');
    END IF;

    INSERT INTO site_settings (key, value, updated_at)
    VALUES (TRIM(p_key), COALESCE(p_value, ''), NOW())
    ON CONFLICT (key) DO UPDATE
    SET value = EXCLUDED.value, updated_at = NOW();

    RETURN jsonb_build_object('status', 'ok');
END;
$$;

-- Пакетне збереження налаштувань (об'єкт ключ-значення)
CREATE OR REPLACE FUNCTION admin_save_settings(p_token TEXT, p_settings JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_key TEXT;
    v_val TEXT;
BEGIN
    UPDATE admin_sessions
    SET expires_at = NOW() + INTERVAL '2 hours'
    WHERE token = p_token AND expires_at > NOW();

    IF NOT FOUND THEN
        RETURN jsonb_build_object('status', 'unauthorized');
    END IF;

    IF p_settings IS NULL OR jsonb_typeof(p_settings) <> 'object' THEN
        RETURN jsonb_build_object('status', 'invalid', 'message', 'Некоректний формат налаштувань');
    END IF;

    FOR v_key, v_val IN SELECT * FROM jsonb_each_text(p_settings)
    LOOP
        IF LENGTH(TRIM(v_key)) > 0 THEN
            INSERT INTO site_settings (key, value, updated_at)
            VALUES (TRIM(v_key), COALESCE(v_val, ''), NOW())
            ON CONFLICT (key) DO UPDATE
            SET value = EXCLUDED.value, updated_at = NOW();
        END IF;
    END LOOP;

    RETURN jsonb_build_object('status', 'ok');
END;
$$;
