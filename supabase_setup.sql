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

-- Увімкнення Row Level Security
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;

-- Дозвіл на читання та вставку для всіх (для публічного доступу)
CREATE POLICY "Allow public read access" ON bookings
    FOR SELECT USING (true);

CREATE POLICY "Allow public insert access" ON bookings
    FOR INSERT WITH CHECK (true);

-- Створення індексу для швидкого пошуку по датах
CREATE INDEX IF NOT EXISTS idx_bookings_dates ON bookings(check_in, check_out);

-- Створення індексу для пошуку по статусу
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status);
