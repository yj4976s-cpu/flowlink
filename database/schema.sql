BEGIN;

-- =========================================================
-- updated_at 자동 변경 함수
-- =========================================================

CREATE FUNCTION flowlink_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- =========================================================
-- 1. 사용자
-- 일반 사용자와 관리자를 하나의 테이블에서 관리
-- =========================================================

CREATE TABLE users (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    email VARCHAR(255) NOT NULL,

    password_hash TEXT
        CHECK (BTRIM(password_hash) <> ''),

    nickname VARCHAR(50) NOT NULL
        CHECK (BTRIM(nickname) <> ''),

    role VARCHAR(10) NOT NULL DEFAULT 'USER'
        CHECK (role IN ('USER', 'ADMIN')),

    active BOOLEAN NOT NULL DEFAULT TRUE,

    terms_agreed_at TIMESTAMPTZ NOT NULL,
    privacy_agreed_at TIMESTAMPTZ NOT NULL,

    last_login_at TIMESTAMPTZ,
    deleted_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CHECK (
        deleted_at IS NULL
        OR active = FALSE
    )
);

CREATE UNIQUE INDEX uq_users_email_lower
    ON users (LOWER(email));


-- =========================================================
-- 1-1. 사용자 소셜 계정
-- provider 이메일이 아닌 provider identity로 계정을 식별
-- =========================================================

CREATE TABLE user_social_accounts (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    user_id BIGINT NOT NULL
        REFERENCES users(id) ON DELETE CASCADE,

    provider VARCHAR(20) NOT NULL
        CHECK (provider IN ('GOOGLE', 'NAVER', 'KAKAO')),

    provider_user_id VARCHAR(255) NOT NULL
        CHECK (BTRIM(provider_user_id) <> ''),

    provider_email VARCHAR(255),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_user_social_accounts_provider_identity
        UNIQUE (provider, provider_user_id),
    CONSTRAINT uq_user_social_accounts_user_provider
        UNIQUE (user_id, provider)
);

ALTER TABLE user_social_accounts ENABLE ROW LEVEL SECURITY;


-- =========================================================
-- 2. 카메라
-- 지도에 표시할 카메라와 촬영 구역
-- =========================================================

CREATE TABLE cameras (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    code VARCHAR(50) NOT NULL UNIQUE,
    name VARCHAR(100) NOT NULL,
    area_name VARCHAR(100) NOT NULL,

    latitude NUMERIC(9, 6)
        CHECK (
            latitude IS NULL
            OR latitude BETWEEN -90 AND 90
        ),

    longitude NUMERIC(9, 6)
        CHECK (
            longitude IS NULL
            OR longitude BETWEEN -180 AND 180
        ),

    is_active BOOLEAN NOT NULL DEFAULT TRUE,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- =========================================================
-- 3. AI 객체 클래스
-- 모델에서 사용하는 클래스 기준정보
-- =========================================================

CREATE TABLE object_classes (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    code VARCHAR(50) NOT NULL UNIQUE
        CHECK (code = UPPER(code)),
    name_ko VARCHAR(50) NOT NULL,

    group_code VARCHAR(30) NOT NULL
        CHECK (
            group_code IN (
                'WASTE',
                'NATURAL',
                'PERSONAL_ITEM',
                'UNKNOWN'
            )
        ),

    display_order INTEGER NOT NULL DEFAULT 0
        CHECK (display_order >= 0),

    is_active BOOLEAN NOT NULL DEFAULT TRUE,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- =========================================================
-- 4. 이미지·영상 탐지 실행
-- 이미지나 영상을 AI가 처리한 한 번의 작업
-- =========================================================

CREATE TABLE detection_events (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    camera_id BIGINT
        REFERENCES cameras(id)
        ON DELETE SET NULL,

    user_id BIGINT
        REFERENCES users(id)
        ON DELETE SET NULL,

    purpose VARCHAR(20) NOT NULL DEFAULT 'OPERATION'
        CHECK (
            purpose IN (
                'USER_ANALYSIS',
                'OPERATION'
            )
        ),

    source_type VARCHAR(10) NOT NULL
        CHECK (
            source_type IN (
                'IMAGE',
                'VIDEO'
            )
        ),

    original_media_url TEXT NOT NULL
        CHECK (BTRIM(original_media_url) <> ''),

    result_media_url TEXT,

    media_width INTEGER
        CHECK (
            media_width IS NULL
            OR media_width > 0
        ),

    media_height INTEGER
        CHECK (
            media_height IS NULL
            OR media_height > 0
        ),

    status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
        CHECK (
            status IN (
                'PENDING',
                'PROCESSING',
                'COMPLETED',
                'FAILED'
            )
        ),

    captured_at TIMESTAMPTZ NOT NULL,

    processing_started_at TIMESTAMPTZ,
    processing_completed_at TIMESTAMPTZ,

    error_message TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CHECK (
        processing_completed_at IS NULL
        OR processing_started_at IS NULL
        OR processing_completed_at >= processing_started_at
    )
);


-- =========================================================
-- 5. 영상 추적 작업
-- VIDEO 탐지 실행의 진행 상태와 추적 설정
-- =========================================================

CREATE TABLE video_jobs (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    detection_event_id BIGINT NOT NULL UNIQUE
        REFERENCES detection_events(id)
        ON DELETE CASCADE,

    status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
        CHECK (
            status IN (
                'PENDING',
                'PROCESSING',
                'COMPLETED',
                'FAILED'
            )
        ),

    processing_progress SMALLINT NOT NULL DEFAULT 0
        CHECK (
            processing_progress BETWEEN 0 AND 100
        ),

    tracking_algorithm VARCHAR(20) NOT NULL DEFAULT 'BYTE_TRACK'
        CHECK (
            tracking_algorithm IN (
                'BYTE_TRACK',
                'BOT_SORT'
            )
        ),

    video_duration_seconds NUMERIC(6, 2)
        CHECK (
            video_duration_seconds IS NULL
            OR (
                video_duration_seconds > 0
                AND video_duration_seconds <= 30
            )
        ),

    processing_started_at TIMESTAMPTZ,
    processing_completed_at TIMESTAMPTZ,

    error_message TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CHECK (
        processing_completed_at IS NULL
        OR processing_started_at IS NULL
        OR processing_completed_at >= processing_started_at
    )
);


-- =========================================================
-- 6. AI가 탐지한 개별 객체
-- 폐기물, 자연물, 개인 물품 후보 모두 저장 가능
-- =========================================================

CREATE TABLE detected_objects (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    detection_event_id BIGINT NOT NULL
        REFERENCES detection_events(id)
        ON DELETE CASCADE,

    object_class_id BIGINT NOT NULL
        REFERENCES object_classes(id),

    -- 관리자 검수 후 확정한 클래스. NULL이면 최초 AI 분류를 사용합니다.
    final_class_code VARCHAR(50)
        REFERENCES object_classes(code),

    processing_status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
        CHECK (
            processing_status IN (
                'PENDING',
                'CONFIRMED',
                'REJECTED'
            )
        ),

    admin_memo TEXT,

    track_id BIGINT,

    confidence NUMERIC(5, 4) NOT NULL
        CHECK (
            confidence BETWEEN 0 AND 1
        ),

    bbox_x NUMERIC(10, 4) NOT NULL
        CHECK (bbox_x >= 0),

    bbox_y NUMERIC(10, 4) NOT NULL
        CHECK (bbox_y >= 0),

    bbox_width NUMERIC(10, 4) NOT NULL
        CHECK (bbox_width > 0),

    bbox_height NUMERIC(10, 4) NOT NULL
        CHECK (bbox_height > 0),

    cropped_image_url TEXT
        CHECK (
            cropped_image_url IS NULL
            OR BTRIM(cropped_image_url) <> ''
        ),

    -- bbox 이미지 기반 AI 추정값과 관리자 최종 확인값을 구분해 저장합니다.
    ai_color VARCHAR(50),
    confirmed_color VARCHAR(50),

    first_seen_ms BIGINT
        CHECK (
            first_seen_ms IS NULL
            OR first_seen_ms >= 0
        ),

    last_seen_ms BIGINT
        CHECK (
            last_seen_ms IS NULL
            OR last_seen_ms >= 0
        ),

    appearance_count INTEGER NOT NULL DEFAULT 1
        CHECK (appearance_count > 0),

    detected_at TIMESTAMPTZ NOT NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CHECK (
        first_seen_ms IS NULL
        OR last_seen_ms IS NULL
        OR last_seen_ms >= first_seen_ms
    )
);


-- =========================================================
-- 7. 발견된 개인 물품
-- 시민 검색과 반환 처리에 사용하는 데이터
-- =========================================================

CREATE TABLE found_items (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    detected_object_id BIGINT UNIQUE
        REFERENCES detected_objects(id)
        ON DELETE SET NULL,

    object_class_id BIGINT NOT NULL
        REFERENCES object_classes(id),

    registered_by BIGINT
        REFERENCES users(id)
        ON DELETE SET NULL,

    source_type VARCHAR(10) NOT NULL
        CHECK (source_type IN ('AI', 'CITIZEN', 'ADMIN')),

    color VARCHAR(50),

    -- 시민 화면에 공개할 특징
    public_description VARCHAR(500),

    -- 소유권 확인 때만 관리자가 확인할 비공개 특징
    private_features TEXT,

    area_name VARCHAR(100) NOT NULL,

    latitude NUMERIC(9, 6)
        CHECK (
            latitude IS NULL
            OR latitude BETWEEN -90 AND 90
        ),

    longitude NUMERIC(9, 6)
        CHECK (
            longitude IS NULL
            OR longitude BETWEEN -180 AND 180
        ),

    found_at TIMESTAMPTZ NOT NULL,

    status VARCHAR(30) NOT NULL DEFAULT 'DETECTED'
        CHECK (
            status IN (
                'DETECTED',
                'RECOVERED',
                'AVAILABLE',
                'CLAIM_PENDING',
                'RETURNED',
                'DISPOSED'
            )
        ),

    storage_location VARCHAR(255),
    admin_memo TEXT,

    is_public BOOLEAN NOT NULL DEFAULT FALSE,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- =========================================================
-- 8. 시민 발견 제보와 추가 목격
-- =========================================================

CREATE TABLE citizen_reports (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id),
    object_class_id BIGINT NOT NULL REFERENCES object_classes(id),
    color VARCHAR(50),
    description TEXT NOT NULL CHECK (BTRIM(description) <> ''),
    image_url TEXT,
    area_name VARCHAR(100) NOT NULL CHECK (BTRIM(area_name) <> ''),
    latitude NUMERIC(9, 6) CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
    longitude NUMERIC(9, 6) CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180),
    found_at TIMESTAMPTZ NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'UNDER_REVIEW', 'LINKED', 'REJECTED', 'CANCELLED')),
    reviewed_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at TIMESTAMPTZ,
    rejection_reason TEXT,
    admin_memo TEXT,
    linked_found_item_id BIGINT REFERENCES found_items(id) ON DELETE SET NULL,
    linked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (status <> 'LINKED' OR (linked_found_item_id IS NOT NULL AND linked_at IS NOT NULL AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)),
    CHECK (status <> 'REJECTED' OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL AND BTRIM(COALESCE(rejection_reason, '')) <> ''))
);

CREATE TABLE citizen_sightings (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    citizen_report_id BIGINT NOT NULL REFERENCES citizen_reports(id),
    user_id BIGINT NOT NULL REFERENCES users(id),
    sighted_at TIMESTAMPTZ NOT NULL,
    location_name VARCHAR(100) NOT NULL CHECK (BTRIM(location_name) <> ''),
    latitude NUMERIC(9, 6) CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
    longitude NUMERIC(9, 6) CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180),
    description TEXT NOT NULL CHECK (BTRIM(description) <> ''),
    image_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- =========================================================
-- 9. 시민 분실 신고
-- =========================================================

CREATE TABLE lost_reports (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    user_id BIGINT NOT NULL
        REFERENCES users(id)
        ON DELETE CASCADE,

    object_class_id BIGINT NOT NULL
        REFERENCES object_classes(id),

    color VARCHAR(50),

    description TEXT NOT NULL
        CHECK (BTRIM(description) <> ''),

    area_name VARCHAR(100) NOT NULL,

    latitude NUMERIC(9, 6)
        CHECK (
            latitude IS NULL
            OR latitude BETWEEN -90 AND 90
        ),

    longitude NUMERIC(9, 6)
        CHECK (
            longitude IS NULL
            OR longitude BETWEEN -180 AND 180
        ),

    lost_from TIMESTAMPTZ NOT NULL,
    lost_to TIMESTAMPTZ,

    image_url TEXT,

    colors JSONB NOT NULL DEFAULT '[]'::JSONB
        CHECK (jsonb_typeof(colors) = 'array' AND jsonb_array_length(colors) <= 3),

    status VARCHAR(20) NOT NULL DEFAULT 'OPEN'
        CHECK (
            status IN (
                'OPEN',
                'MATCHED',
                'CLAIM_PENDING',
                'RESOLVED',
                'CANCELLED'
            )
        ),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CHECK (
        lost_to IS NULL
        OR lost_to >= lost_from
    )
);


-- =========================================================
-- 9. 분실 신고와 발견물 자동 매칭 결과
-- =========================================================

CREATE TABLE match_candidates (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    lost_report_id BIGINT NOT NULL
        REFERENCES lost_reports(id)
        ON DELETE CASCADE,

    found_item_id BIGINT NOT NULL
        REFERENCES found_items(id)
        ON DELETE CASCADE,

    total_score SMALLINT NOT NULL
        CHECK (
            total_score BETWEEN 0 AND 100
        ),

    type_score SMALLINT NOT NULL DEFAULT 0
        CHECK (
            type_score BETWEEN 0 AND 40
        ),

    area_score SMALLINT NOT NULL DEFAULT 0
        CHECK (
            area_score BETWEEN 0 AND 25
        ),

    time_score SMALLINT NOT NULL DEFAULT 0
        CHECK (
            time_score BETWEEN 0 AND 20
        ),

    keyword_score SMALLINT NOT NULL DEFAULT 0
        CHECK (
            keyword_score BETWEEN 0 AND 15
        ),

    status VARCHAR(20) NOT NULL DEFAULT 'SUGGESTED'
        CHECK (
            status IN (
                'SUGGESTED',
                'NOTIFIED',
                'VIEWED',
                'DISMISSED',
                'CLAIMED'
            )
        ),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (
        lost_report_id,
        found_item_id
    ),

    CHECK (
        total_score
        = type_score
        + area_score
        + time_score
        + keyword_score
    )
);


-- =========================================================
-- 10. 소유권 확인 요청
-- =========================================================

CREATE TABLE ownership_claims (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    user_id BIGINT NOT NULL
        REFERENCES users(id)
        ON DELETE CASCADE,

    lost_report_id BIGINT
        REFERENCES lost_reports(id)
        ON DELETE SET NULL,

    found_item_id BIGINT NOT NULL
        REFERENCES found_items(id)
        ON DELETE CASCADE,

    verification_details TEXT NOT NULL
        CHECK (BTRIM(verification_details) <> ''),

    additional_image_url TEXT,

    status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
        CHECK (
            status IN (
                'PENDING',
                'APPROVED',
                'REJECTED',
                'RETURNED'
            )
        ),

    reviewed_by BIGINT
        REFERENCES users(id)
        ON DELETE SET NULL,

    reviewed_at TIMESTAMPTZ,
    rejection_reason TEXT,
    admin_memo TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- =========================================================
-- 11. 사용자·관리자 알림
-- DB가 알림의 본체이고 WebSocket은 전달 수단
-- =========================================================

CREATE TABLE notifications (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    user_id BIGINT NOT NULL
        REFERENCES users(id)
        ON DELETE CASCADE,

    notification_type VARCHAR(30) NOT NULL
        CHECK (
            notification_type IN (
                'DETECTION_COMPLETED',
                'MATCH_FOUND',
                'STATUS_CHANGED',
                'CITIZEN_REPORT_STATUS'
            )
        ),

    title VARCHAR(150) NOT NULL
        CHECK (BTRIM(title) <> ''),

    message TEXT NOT NULL
        CHECK (BTRIM(message) <> ''),

    related_type VARCHAR(50),
    related_id BIGINT,

    read_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- =========================================================
-- DARU MEMORY 통계 및 난이도별 랭킹
-- =========================================================

CREATE TABLE public.daru_game_stats (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    user_id BIGINT NOT NULL
        REFERENCES public.users(id)
        ON DELETE CASCADE,

    difficulty VARCHAR(10) NOT NULL
        CHECK (difficulty IN ('EASY', 'NORMAL', 'HARD')),

    best_detection_power NUMERIC(4,1) NOT NULL DEFAULT 0.0
        CHECK (best_detection_power BETWEEN 0 AND 100),

    score_version INTEGER NOT NULL DEFAULT 2
        CHECK (score_version IN (1, 2)),

    best_hints_used SMALLINT
        CHECK (
            best_hints_used IS NULL
            OR best_hints_used BETWEEN 0 AND 2
        ),

    best_attempts INTEGER
        CHECK (
            best_attempts IS NULL
            OR best_attempts > 0
        ),

    best_elapsed_seconds INTEGER
        CHECK (
            best_elapsed_seconds IS NULL
            OR best_elapsed_seconds > 0
        ),

    best_combo INTEGER NOT NULL DEFAULT 0
        CHECK (best_combo >= 0),

    total_daru_points BIGINT NOT NULL DEFAULT 0
        CHECK (total_daru_points >= 0),

    play_count INTEGER NOT NULL DEFAULT 0
        CHECK (play_count >= 0),

    best_achieved_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (user_id, difficulty)
);

ALTER TABLE public.daru_game_stats
ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.daru_game_runs (
    id UUID PRIMARY KEY,

    user_id BIGINT NOT NULL
        REFERENCES public.users(id)
        ON DELETE CASCADE,

    difficulty VARCHAR(10) NOT NULL
        CHECK (difficulty IN ('EASY', 'NORMAL', 'HARD')),

    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    play_started_at TIMESTAMPTZ,
    consumed_at TIMESTAMPTZ,
    deck_state JSONB NOT NULL DEFAULT '[]'::JSONB,
    first_position INTEGER,
    matched_positions JSONB NOT NULL DEFAULT '[]'::JSONB,
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    matched_pairs INTEGER NOT NULL DEFAULT 0 CHECK (matched_pairs >= 0),
    current_combo INTEGER NOT NULL DEFAULT 0 CHECK (current_combo >= 0),
    max_combo INTEGER NOT NULL DEFAULT 0 CHECK (max_combo >= current_combo),
    hints_used INTEGER NOT NULL DEFAULT 0 CHECK (hints_used BETWEEN 0 AND 2),
    earned_daru_points BIGINT NOT NULL DEFAULT 0 CHECK (earned_daru_points >= 0),

    CHECK (
        consumed_at IS NULL
        OR consumed_at >= started_at
    ),
    CHECK (first_position IS NULL OR first_position >= 0)
);

ALTER TABLE public.daru_game_runs
ENABLE ROW LEVEL SECURITY;

-- =========================================================
-- 12. 관리자 처리 이력
-- 분류 수정, 회수, 승인, 반환 등의 기록
-- =========================================================

CREATE TABLE community_posts (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category VARCHAR(20) NOT NULL CHECK (category IN ('FIELD_STORY', 'QUESTION', 'EXPERIENCE', 'OPINION')),
    title VARCHAR(120) NOT NULL CHECK (BTRIM(title) <> ''),
    content TEXT NOT NULL CHECK (BTRIM(content) <> ''),
    place_name VARCHAR(120), address VARCHAR(255),
    latitude NUMERIC(9, 6) CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
    longitude NUMERIC(9, 6) CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180),
    image_url TEXT, is_notice BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), deleted_at TIMESTAMPTZ,
    CHECK ((latitude IS NULL) = (longitude IS NULL))
);

CREATE TABLE community_comments (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    post_id BIGINT NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
    parent_comment_id BIGINT REFERENCES community_comments(id) ON DELETE CASCADE,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content TEXT NOT NULL CHECK (BTRIM(content) <> ''),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_community_posts_feed ON community_posts (is_notice DESC, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_community_comments_post ON community_comments (post_id, created_at) WHERE deleted_at IS NULL;
CREATE INDEX idx_community_comments_parent ON community_comments (parent_comment_id, created_at) WHERE deleted_at IS NULL;

CREATE TABLE processing_histories (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    actor_user_id BIGINT
        REFERENCES users(id)
        ON DELETE SET NULL,

    entity_type VARCHAR(30) NOT NULL
        CHECK (
            entity_type IN (
                'DETECTION_EVENT',
                'DETECTED_OBJECT',
                'FOUND_ITEM',
                'LOST_REPORT',
                'MATCH_CANDIDATE',
                'OWNERSHIP_CLAIM',
                'VIDEO_JOB'
                ,'CITIZEN_REPORT'
                ,'CITIZEN_SIGHTING'
            )
        ),

    entity_id BIGINT NOT NULL,

    action_type VARCHAR(50) NOT NULL,

    previous_status VARCHAR(30),
    new_status VARCHAR(30),

    note TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- =========================================================
-- updated_at 자동 갱신 트리거
-- =========================================================

CREATE TRIGGER trg_users_updated_at
BEFORE UPDATE ON users
FOR EACH ROW
EXECUTE FUNCTION flowlink_set_updated_at();

CREATE TRIGGER trg_user_social_accounts_updated_at
BEFORE UPDATE ON user_social_accounts
FOR EACH ROW
EXECUTE FUNCTION flowlink_set_updated_at();

CREATE TRIGGER trg_cameras_updated_at
BEFORE UPDATE ON cameras
FOR EACH ROW
EXECUTE FUNCTION flowlink_set_updated_at();

CREATE TRIGGER trg_object_classes_updated_at
BEFORE UPDATE ON object_classes
FOR EACH ROW
EXECUTE FUNCTION flowlink_set_updated_at();

CREATE TRIGGER trg_detection_events_updated_at
BEFORE UPDATE ON detection_events
FOR EACH ROW
EXECUTE FUNCTION flowlink_set_updated_at();

CREATE TRIGGER trg_video_jobs_updated_at
BEFORE UPDATE ON video_jobs
FOR EACH ROW
EXECUTE FUNCTION flowlink_set_updated_at();

CREATE TRIGGER trg_found_items_updated_at
BEFORE UPDATE ON found_items
FOR EACH ROW
EXECUTE FUNCTION flowlink_set_updated_at();

CREATE TRIGGER trg_citizen_reports_updated_at
BEFORE UPDATE ON citizen_reports
FOR EACH ROW
EXECUTE FUNCTION flowlink_set_updated_at();

CREATE TRIGGER trg_lost_reports_updated_at
BEFORE UPDATE ON lost_reports
FOR EACH ROW
EXECUTE FUNCTION flowlink_set_updated_at();

CREATE TRIGGER trg_match_candidates_updated_at
BEFORE UPDATE ON match_candidates
FOR EACH ROW
EXECUTE FUNCTION flowlink_set_updated_at();

CREATE TRIGGER trg_ownership_claims_updated_at
BEFORE UPDATE ON ownership_claims
FOR EACH ROW
EXECUTE FUNCTION flowlink_set_updated_at();


-- =========================================================
-- 조회 성능용 인덱스
-- =========================================================

CREATE INDEX idx_detection_events_status
    ON detection_events (status);

CREATE INDEX idx_detection_events_captured_at
    ON detection_events (captured_at DESC);

CREATE INDEX idx_detection_events_user_purpose_created
    ON detection_events (
        user_id,
        purpose,
        created_at DESC
    );

CREATE INDEX idx_detected_objects_event
    ON detected_objects (detection_event_id);

CREATE INDEX idx_detected_objects_class
    ON detected_objects (object_class_id);

CREATE INDEX idx_detected_objects_processing_status
    ON detected_objects (processing_status);

CREATE INDEX idx_detected_objects_track
    ON detected_objects (track_id)
    WHERE track_id IS NOT NULL;

CREATE INDEX idx_found_items_status_date
    ON found_items (
        status,
        found_at DESC
    );

CREATE INDEX idx_found_items_area
    ON found_items (area_name);

CREATE INDEX idx_found_items_source_created
    ON found_items (source_type, created_at DESC);

CREATE INDEX idx_citizen_reports_user_created
    ON citizen_reports (user_id, created_at DESC);

CREATE INDEX idx_citizen_reports_status_found
    ON citizen_reports (status, found_at DESC, id DESC);

CREATE INDEX idx_citizen_reports_class_found
    ON citizen_reports (object_class_id, found_at DESC);

CREATE INDEX idx_citizen_reports_linked_item
    ON citizen_reports (linked_found_item_id);

CREATE INDEX idx_citizen_sightings_report_date
    ON citizen_sightings (citizen_report_id, sighted_at DESC, id DESC);

CREATE INDEX idx_citizen_sightings_user_created
    ON citizen_sightings (user_id, created_at DESC);

CREATE INDEX idx_lost_reports_user
    ON lost_reports (
        user_id,
        created_at DESC
    );

CREATE INDEX idx_lost_reports_status
    ON lost_reports (status);

CREATE INDEX idx_lost_reports_area
    ON lost_reports (area_name);

CREATE INDEX idx_match_candidates_report_score
    ON match_candidates (
        lost_report_id,
        total_score DESC
    );

CREATE INDEX idx_match_candidates_found_item
    ON match_candidates (found_item_id);

CREATE INDEX idx_ownership_claims_status
    ON ownership_claims (
        status,
        created_at DESC
    );

CREATE UNIQUE INDEX uq_ownership_claims_with_report
    ON ownership_claims (
        user_id,
        lost_report_id,
        found_item_id
    )
    WHERE lost_report_id IS NOT NULL;

CREATE UNIQUE INDEX uq_ownership_claims_without_report
    ON ownership_claims (
        user_id,
        found_item_id
    )
    WHERE lost_report_id IS NULL;

CREATE INDEX idx_notifications_user_created
    ON notifications (
        user_id,
        created_at DESC
    );

CREATE INDEX idx_notifications_unread
    ON notifications (
        user_id,
        created_at DESC
    )
    WHERE read_at IS NULL;

CREATE INDEX idx_daru_game_stats_ranking
    ON public.daru_game_stats (
        difficulty,
        score_version,
        best_detection_power DESC,
        best_attempts ASC,
        best_elapsed_seconds ASC,
        best_achieved_at ASC
    );

CREATE INDEX idx_daru_game_runs_active_user
    ON public.daru_game_runs (user_id, started_at DESC)
    WHERE consumed_at IS NULL;

CREATE INDEX idx_processing_histories_entity
    ON processing_histories (
        entity_type,
        entity_id,
        created_at DESC
    );

CREATE INDEX idx_video_jobs_status
    ON video_jobs (status);

CREATE TABLE copilot_conversations (id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, public_id VARCHAR(36) NOT NULL UNIQUE, user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE, title VARCHAR(120) NOT NULL, context_type VARCHAR(30) NOT NULL DEFAULT 'GENERAL', context_entity_id BIGINT, summary TEXT, summary_updated_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), last_message_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), deleted_at TIMESTAMPTZ);
CREATE TABLE copilot_messages (id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, conversation_id BIGINT NOT NULL REFERENCES copilot_conversations(id) ON DELETE CASCADE, role VARCHAR(12) NOT NULL CHECK (role IN ('USER','ASSISTANT')), content TEXT NOT NULL, presentation_type VARCHAR(30) NOT NULL DEFAULT 'TEXT', presentation JSONB, client_message_id VARCHAR(64), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(conversation_id,client_message_id));
CREATE TABLE copilot_message_refs (id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, message_id BIGINT NOT NULL REFERENCES copilot_messages(id) ON DELETE CASCADE, ref_type VARCHAR(30) NOT NULL, ref_id BIGINT NOT NULL, UNIQUE(message_id,ref_type,ref_id));
CREATE INDEX idx_copilot_conversations_user_recent ON copilot_conversations(user_id,last_message_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_copilot_messages_order ON copilot_messages(conversation_id,id);


-- =========================================================
-- AI 클래스 초기 데이터
-- 신발 클래스명은 FOOTWEAR로 통일
-- =========================================================

INSERT INTO object_classes (
    code,
    name_ko,
    group_code,
    display_order
)
VALUES
    ('TRASH', '폐기물', 'WASTE', 1),
    ('BRANCH', '나뭇가지', 'NATURAL', 2),
    ('AQUATIC_PLANT', '수생식물', 'NATURAL', 3),
    ('BALL', '공', 'PERSONAL_ITEM', 10),
    ('BAG', '가방', 'PERSONAL_ITEM', 11),
    ('UMBRELLA', '우산', 'PERSONAL_ITEM', 12),
    ('FOOTWEAR', '신발·슬리퍼류', 'PERSONAL_ITEM', 13),
    -- AI 모델 클래스가 아닌 관리자 재분류용 서비스 클래스
    ('UNKNOWN', '미확인 부유물', 'UNKNOWN', 99)
ON CONFLICT (code)
DO UPDATE SET
    name_ko = EXCLUDED.name_ko,
    group_code = EXCLUDED.group_code,
    display_order = EXCLUDED.display_order,
    is_active = TRUE,
    updated_at = NOW();

COMMIT;
