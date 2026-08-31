-- ============================================================================
-- Налаштування сайту: загальні тексти, які редагуються з адмін-панелі
-- ============================================================================

CREATE TABLE IF NOT EXISTS site_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE site_settings ENABLE ROW LEVEL SECURITY;

-- Публічне читання (це видимий контент сайту), запис — лише через RPC
DROP POLICY IF EXISTS "Public read site_settings" ON site_settings;
CREATE POLICY "Public read site_settings" ON site_settings
    FOR SELECT TO public USING (true);

-- Дефолтні значення спільних текстів
INSERT INTO site_settings (key, value) VALUES
(
    'cottage_details_footer',
    'Котеджі повністю оснащені усім необхідним для комфортного проживання — вам варто взяти лише особисті річі.|* Додаткове місце в котеджі оплачується окремо.|На території містечка є всі необхідні зручності: ресторан, дитячий та спортивний майданчики, власна парковка, цілодобова охорона, лижна школа та прокат спорядження, спа-комплекс, а розваги курорту Буковель — всього за 2 км.|До зустрічі в EcoBerghaus! Чекаємо на знайомство з вами 💛'
),
(
    'tariff_includes',
    'Безкоштовне скасування бронювання за 7 днів до заїзду|Сніданок «Шведська лінія» включено у вартість|Безлімітний доступ до басейну та SPA-комплексу Rosa'
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

-- Зберегти налаштування (key -> value)
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

    IF p_key IS NULL OR LENGTH(TRIM(p_key)) = 0 OR NOT EXISTS (
        SELECT 1 FROM site_settings WHERE key = p_key
    ) THEN
        RETURN jsonb_build_object('status', 'invalid', 'message', 'Невідомий ключ налаштування');
    END IF;

    UPDATE site_settings
    SET value = p_value, updated_at = NOW()
    WHERE key = p_key;

    RETURN jsonb_build_object('status', 'ok');
END;
$$;
