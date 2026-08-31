-- Службовий тест: повертаємо сайт у відкритий режим
UPDATE site_settings SET value = 'false' WHERE key = 'site_closed';
