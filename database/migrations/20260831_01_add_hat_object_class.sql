BEGIN;

INSERT INTO object_classes (
    code,
    name_ko,
    group_code,
    display_order,
    is_active,
    created_at,
    updated_at
)
VALUES (
    'HAT',
    '모자',
    'PERSONAL_ITEM',
    14,
    TRUE,
    NOW(),
    NOW()
)
ON CONFLICT (code)
DO UPDATE SET
    name_ko = EXCLUDED.name_ko,
    group_code = EXCLUDED.group_code,
    display_order = EXCLUDED.display_order,
    is_active = TRUE,
    updated_at = NOW();

COMMIT;
