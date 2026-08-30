-- ============================================================================
-- admin_save_cottage: підтримка поля photos (список URL через кому)
-- ============================================================================

CREATE OR REPLACE FUNCTION admin_save_cottage(p_token TEXT, p_data JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_id UUID;
    v_photos TEXT;
BEGIN
    UPDATE admin_sessions
    SET expires_at = NOW() + INTERVAL '2 hours'
    WHERE token = p_token AND expires_at > NOW();

    IF NOT FOUND THEN
        RETURN jsonb_build_object('status', 'unauthorized');
    END IF;

    v_id := NULLIF(p_data->>'id', '')::UUID;
    v_photos := NULLIF(TRIM(p_data->>'photos'), '');

    IF v_id IS NULL THEN
        INSERT INTO cottages (
            name, guest_count, cottage_numbers, floors, bedrooms,
            price, tariff, status, description, photos, updated_at
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
