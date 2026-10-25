-- =========================================================
-- Миграция 001: начальная схема БД
-- Применяется один раз. Повторный запуск не нужен.
-- =========================================================

-- Расширение btree_gist нужно для EXCLUDE-ограничения
-- на пересечение интервалов (Этап 4).
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- =========================================================
-- Таблица: users
-- =========================================================
CREATE TABLE users (
    id            SERIAL PRIMARY KEY,
    name          VARCHAR(100) NOT NULL,
    login         VARCHAR(50)  NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    role          VARCHAR(10)  NOT NULL DEFAULT 'user',
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT users_role_check
        CHECK (role IN ('user', 'admin'))
);

COMMENT ON TABLE  users IS 'Пользователи системы (пользователи и администраторы)';
COMMENT ON COLUMN users.role IS 'Роль: user или admin';
COMMENT ON COLUMN users.password_hash IS 'bcrypt-хеш пароля, никогда не хранится в открытом виде';


-- =========================================================
-- Таблица: resources (переговорные комнаты)
-- =========================================================
CREATE TABLE resources (
    id          SERIAL PRIMARY KEY,
    name        VARCHAR(200) NOT NULL,
    description TEXT,
    location    VARCHAR(200) NOT NULL,
    is_active   BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT resources_name_not_empty
        CHECK (LENGTH(TRIM(name)) > 0),
    CONSTRAINT resources_location_not_empty
        CHECK (LENGTH(TRIM(location)) > 0)
);

COMMENT ON TABLE  resources IS 'Переговорные комнаты — бронируемые ресурсы';
COMMENT ON COLUMN resources.is_active IS 'false = отключён, новые бронирования невозможны';
COMMENT ON COLUMN resources.location IS 'Корпус / этаж / номер кабинета';


-- =========================================================
-- Таблица: bookings (бронирования)
-- =========================================================
CREATE TABLE bookings (
    id             SERIAL PRIMARY KEY,
    resource_id    INTEGER      NOT NULL REFERENCES resources(id) ON DELETE RESTRICT,
    owner_id       INTEGER      NOT NULL REFERENCES users(id)     ON DELETE RESTRICT,
    start_time     TIMESTAMPTZ  NOT NULL,
    end_time       TIMESTAMPTZ  NOT NULL,
    purpose        VARCHAR(300) NOT NULL,
    status         VARCHAR(10)  NOT NULL DEFAULT 'active',
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    -- сведения об отмене (заполняются при отмене)
    cancelled_at   TIMESTAMPTZ,
    cancelled_by   INTEGER      REFERENCES users(id) ON DELETE RESTRICT,
    cancel_reason  TEXT,

    -- окончание строго позже начала
    CONSTRAINT bookings_time_order
        CHECK (end_time > start_time),

    -- цель от 5 до 300 символов
    CONSTRAINT bookings_purpose_length
        CHECK (LENGTH(TRIM(purpose)) BETWEEN 5 AND 300),

    -- допустимые статусы
    CONSTRAINT bookings_status_check
        CHECK (status IN ('active', 'cancelled')),

    -- если статус cancelled — причина отмены обязательна
    CONSTRAINT bookings_cancel_reason_required
        CHECK (status <> 'cancelled' OR cancel_reason IS NOT NULL)
);

COMMENT ON TABLE  bookings IS 'Бронирования переговорных';
COMMENT ON COLUMN bookings.status IS 'active = занимает время, cancelled = не занимает';
COMMENT ON COLUMN bookings.start_time IS 'Хранится в UTC (TIMESTAMPTZ)';
COMMENT ON COLUMN bookings.purpose IS 'Цель брони, 5–300 символов';
COMMENT ON COLUMN bookings.cancel_reason IS 'Обязательна при status = cancelled';


-- =========================================================
-- Ключевое ограничение: запрет пересечений
-- =========================================================
-- Для одного и того же ресурса интервалы [start_time, end_time)
-- не должны пересекаться, но только среди активных записей.
-- Отменённые брони время НЕ занимают.
ALTER TABLE bookings
    ADD CONSTRAINT bookings_no_overlap
    EXCLUDE USING gist (
        resource_id WITH =,
        tstzrange(start_time, end_time, '[)') WITH &&
    )
    WHERE (status = 'active');

-- =========================================================
-- Индексы для типичных запросов приложения
-- =========================================================
-- 1) "Мои бронирования" — выборка по владельцу, сортировка по времени
CREATE INDEX idx_bookings_owner_start
    ON bookings (owner_id, start_time DESC);

-- 2) "Занятые интервалы ресурса на дату" — выборка по ресурсу и диапазону
CREATE INDEX idx_bookings_resource_time
    ON bookings (resource_id, start_time, end_time)
    WHERE status = 'active';

    
-- =========================================================
-- Таблица: idempotency_keys (защита от двойного нажатия)
-- =========================================================
CREATE TABLE idempotency_keys (
    id                  SERIAL PRIMARY KEY,
    user_id             INTEGER      NOT NULL REFERENCES users(id)    ON DELETE RESTRICT,
    key                 VARCHAR(100) NOT NULL,
    request_fingerprint VARCHAR(255) NOT NULL,
    booking_id          INTEGER      REFERENCES bookings(id)          ON DELETE SET NULL,
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    -- Ключ уникален в пределах пользователя
    CONSTRAINT idempotency_keys_user_key_unique
        UNIQUE (user_id, key)
);

COMMENT ON TABLE  idempotency_keys IS 'Ключи идемпотентности: один ключ = одна попытка создания брони';
COMMENT ON COLUMN idempotency_keys.key IS 'UUID, сгенерированный клиентом перед отправкой формы';
COMMENT ON COLUMN idempotency_keys.request_fingerprint IS 'Хеш нормализованных данных запроса, чтобы отличить повтор от другого запроса';
COMMENT ON COLUMN idempotency_keys.booking_id IS 'Ссылка на созданную бронь, чтобы при повторе вернуть тот же результат';


-- =========================================================
-- Таблица: audit_events (аудит действий)
-- =========================================================
CREATE TABLE audit_events (
    id          SERIAL PRIMARY KEY,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    actor_id    INTEGER      REFERENCES users(id) ON DELETE SET NULL,
    action      VARCHAR(50)  NOT NULL,
    target_type VARCHAR(30)  NOT NULL,
    target_id   INTEGER,
    result      VARCHAR(20)  NOT NULL DEFAULT 'success',
    request_id  VARCHAR(50),

    CONSTRAINT audit_result_check
        CHECK (result IN ('success', 'failure'))
);

COMMENT ON TABLE  audit_events IS 'Аудит: история создания/отмены броней, изменения ресурсов';
COMMENT ON COLUMN audit_events.actor_id IS 'Кто выполнил; NULL = система';
COMMENT ON COLUMN audit_events.action IS 'Например: booking.created, booking.cancelled, resource.updated';
COMMENT ON COLUMN audit_events.request_id IS 'ID запроса для связи с техническими логами (по traceId)';

-- Индекс для админской выборки аудита (сортировка по времени)
CREATE INDEX idx_audit_events_created_at
    ON audit_events (created_at DESC);