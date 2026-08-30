ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS username TEXT;
UPDATE admin_users SET username = 'admin' WHERE email = 'admin@ecoberghaus.com.ua' OR username IS NULL;
ALTER TABLE admin_users ALTER COLUMN username SET NOT NULL;
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'admin_users_username_key'
    ) THEN
        ALTER TABLE admin_users ADD CONSTRAINT admin_users_username_key UNIQUE (username);
    END IF;
END $$;

DROP FUNCTION IF EXISTS admin_initiate_login(text, text, text, text, text);

CREATE OR REPLACE FUNCTION admin_initiate_login(
    p_username TEXT,
    p_password TEXT,
    p_ip TEXT,
    p_otp_code TEXT,
    p_salt TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_admin admin_users%ROWTYPE;
    v_attempts admin_login_attempts%ROWTYPE;
    v_session_id UUID;
    v_otp_hash TEXT;
BEGIN
    SELECT * INTO v_attempts FROM admin_login_attempts WHERE ip_address = p_ip;
    
    IF FOUND AND v_attempts.locked_until IS NOT NULL AND v_attempts.locked_until > NOW() THEN
        RETURN jsonb_build_object(
            'status', 'locked',
            'locked_until', v_attempts.locked_until,
            'retry_after_seconds', EXTRACT(EPOCH FROM (v_attempts.locked_until - NOW()))::INT
        );
    END IF;

    SELECT * INTO v_admin FROM admin_users 
    WHERE LOWER(TRIM(username)) = LOWER(TRIM(p_username))
       OR (email IS NOT NULL AND LOWER(TRIM(email)) = LOWER(TRIM(p_username)));

    IF NOT FOUND OR v_admin.password_hash != crypt(p_password, v_admin.password_hash) THEN
        INSERT INTO admin_login_attempts (ip_address, failed_count, last_attempt, locked_until)
        VALUES (p_ip, 1, NOW(), NULL)
        ON CONFLICT (ip_address) DO UPDATE
        SET failed_count = admin_login_attempts.failed_count + 1,
            last_attempt = NOW(),
            locked_until = CASE 
                WHEN admin_login_attempts.failed_count + 1 >= 5 THEN NOW() + INTERVAL '15 minutes'
                ELSE NULL
            END
        RETURNING * INTO v_attempts;

        IF v_attempts.failed_count >= 5 THEN
            RETURN jsonb_build_object(
                'status', 'locked',
                'locked_until', v_attempts.locked_until,
                'retry_after_seconds', 900
            );
        ELSE
            RETURN jsonb_build_object(
                'status', 'invalid_credentials',
                'attempts_left', 5 - v_attempts.failed_count
            );
        END IF;
    END IF;

    DELETE FROM admin_login_attempts WHERE ip_address = p_ip;

    v_otp_hash := encode(digest(p_otp_code || p_salt, 'sha256'), 'hex');

    INSERT INTO admin_otp_sessions (user_id, otp_hash, salt, attempts_left, expires_at, consumed)
    VALUES (v_admin.id, v_otp_hash, p_salt, 3, NOW() + INTERVAL '3 minutes', false)
    RETURNING id INTO v_session_id;

    RETURN jsonb_build_object(
        'status', 'otp_created',
        'session_id', v_session_id,
        'user_id', v_admin.id,
        'username', v_admin.username,
        'expires_in_seconds', 180
    );
END;
$$;

INSERT INTO admin_users (username, email, password_hash, role)
VALUES (
    'admin',
    'admin@ecoberghaus.com.ua',
    crypt('EcoBerghaus2026!', gen_salt('bf', 12)),
    'admin'
)
ON CONFLICT (username) DO UPDATE
SET password_hash = crypt('EcoBerghaus2026!', gen_salt('bf', 12));
