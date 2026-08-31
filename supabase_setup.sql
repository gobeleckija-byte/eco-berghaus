-- Створення таблиці бронювань
CREATE TABLE IF NOT EXISTS bookings (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    check_in DATE NOT NULL,
    check_out DATE NOT NULL,
    guest_name TEXT NOT NULL,
    guest_phone TEXT NOT NULL,
    adults_count INTEGER DEFAULT 1,
    children_count INTEGER DEFAULT 0,
    status TEXT DEFAULT 'pending', -- pending, confirmed, cancelled
    notes TEXT,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Додавання cottage_id якщо його немає
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'bookings' AND column_name = 'cottage_id'
    ) THEN
        ALTER TABLE bookings ADD COLUMN cottage_id UUID;
    END IF;
END $$;

-- Увімкнення Row Level Security
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;

-- Видалення існуючих полісів якщо вони є
DROP POLICY IF EXISTS "Allow public read access" ON bookings;
DROP POLICY IF EXISTS "Allow public insert access" ON bookings;
DROP POLICY IF EXISTS "Allow public update access" ON bookings;
DROP POLICY IF EXISTS "Allow public delete access" ON bookings;

-- Дозвіл на читання та вставку для всіх (для публічного доступу)
CREATE POLICY "Allow public read access" ON bookings
    FOR SELECT USING (true);

CREATE POLICY "Allow public insert access" ON bookings
    FOR INSERT WITH CHECK (true);

CREATE POLICY "Allow public update access" ON bookings
    FOR UPDATE USING (true);

CREATE POLICY "Allow public delete access" ON bookings
    FOR DELETE USING (true);

-- Створення таблиці котеджів
CREATE TABLE IF NOT EXISTS cottages (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL,
    guest_count INTEGER NOT NULL,
    cottage_numbers TEXT NOT NULL,
    floors INTEGER NOT NULL,
    bedrooms INTEGER NOT NULL,
    price NUMERIC NOT NULL,
    tariff TEXT,
    status TEXT DEFAULT 'active',
    description TEXT NOT NULL,
    photos TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Увімкнення Row Level Security для cottages
ALTER TABLE cottages ENABLE ROW LEVEL SECURITY;

-- Видалення існуючих полісів якщо вони є
DROP POLICY IF EXISTS "Allow public read access cottages" ON cottages;
DROP POLICY IF EXISTS "Allow public insert access cottages" ON cottages;
DROP POLICY IF EXISTS "Allow public update access cottages" ON cottages;
DROP POLICY IF EXISTS "Allow public delete access cottages" ON cottages;

-- Дозвіл на читання та вставку для всіх (для публічного доступу)
CREATE POLICY "Allow public read access cottages" ON cottages
    FOR SELECT USING (true);

CREATE POLICY "Allow public insert access cottages" ON cottages
    FOR INSERT WITH CHECK (true);

CREATE POLICY "Allow public update access cottages" ON cottages
    FOR UPDATE USING (true);

CREATE POLICY "Allow public delete access cottages" ON cottages
    FOR DELETE USING (true);

-- Додавання foreign key для cottage_id в таблиці bookings
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'fk_cottage' AND table_name = 'bookings'
    ) THEN
        ALTER TABLE bookings 
        ADD CONSTRAINT fk_cottage 
        FOREIGN KEY (cottage_id) 
        REFERENCES cottages(id) 
        ON DELETE SET NULL;
    END IF;
END $$;

-- Створення індексу для швидкого пошуку по датах
CREATE INDEX IF NOT EXISTS idx_bookings_dates ON bookings(check_in, check_out);

-- Створення індексу для пошуку по статусу
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status);

-- Створення індексу для пошуку по cottage_id
CREATE INDEX IF NOT EXISTS idx_bookings_cottage ON bookings(cottage_id);

-- Створення таблиці промокодів
CREATE TABLE IF NOT EXISTS promo_codes (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    discount INTEGER NOT NULL, -- відсоток знижки
    active BOOLEAN DEFAULT true,
    max_uses INTEGER,
    current_uses INTEGER DEFAULT 0,
    valid_from TIMESTAMP WITH TIME ZONE,
    valid_until TIMESTAMP WITH TIME ZONE,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Увімкнення Row Level Security для promo_codes
ALTER TABLE promo_codes ENABLE ROW LEVEL SECURITY;

-- Видалення існуючих полісів якщо вони є
DROP POLICY IF EXISTS "Allow public read access promo" ON promo_codes;
DROP POLICY IF EXISTS "Allow public insert access promo" ON promo_codes;
DROP POLICY IF EXISTS "Allow public update access promo" ON promo_codes;
DROP POLICY IF EXISTS "Allow public delete access promo" ON promo_codes;

-- Дозвіл на читання та вставку для всіх (для публічного доступу)
CREATE POLICY "Allow public read access promo" ON promo_codes
    FOR SELECT USING (true);

CREATE POLICY "Allow public insert access promo" ON promo_codes
    FOR INSERT WITH CHECK (true);

CREATE POLICY "Allow public update access promo" ON promo_codes
    FOR UPDATE USING (true);

CREATE POLICY "Allow public delete access promo" ON promo_codes
    FOR DELETE USING (true);

-- Створення індексу для пошуку по коду промокоду
CREATE INDEX IF NOT EXISTS idx_promo_codes_code ON promo_codes(code);

-- Створення індексу для пошуку активних промокодів
CREATE INDEX IF NOT EXISTS idx_promo_codes_active ON promo_codes(active);

-- ============================================================================
-- Таблиця налаштувань сайту (site_settings)
-- ============================================================================
CREATE TABLE IF NOT EXISTS site_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE site_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public read site_settings" ON site_settings;
CREATE POLICY "Allow public read site_settings" ON site_settings
    FOR SELECT TO public USING (true);

-- Дефолтні налаштування
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
