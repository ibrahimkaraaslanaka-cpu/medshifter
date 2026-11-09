-- Run only against a new, empty MedShifter database. Firebase user IDs are text:
-- imported Supabase UUIDs and newly created Firebase IDs must both fit.
BEGIN;

CREATE TABLE profiles (
    id text PRIMARY KEY,
    email text NOT NULL UNIQUE,
    name text,
    avatar text,
    plan text NOT NULL DEFAULT 'FREE' CHECK (plan IN ('FREE', 'INDIVIDUAL', 'BUSINESS')),
    plan_expires_at timestamptz,
    calendars_used_this_month integer NOT NULL DEFAULT 0,
    saves_used_this_month integer NOT NULL DEFAULT 0,
    exports_used_this_month integer NOT NULL DEFAULT 0,
    usage_reset_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE admins (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    username text NOT NULL UNIQUE,
    password_hash text NOT NULL,
    name text,
    role text NOT NULL DEFAULT 'admin' CHECK (role IN ('admin', 'superadmin')),
    last_login_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE calendars (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id text NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    title text NOT NULL,
    month integer NOT NULL CHECK (month BETWEEN 0 AND 11),
    year integer NOT NULL,
    people jsonb NOT NULL DEFAULT '[]'::jsonb,
    work_areas jsonb NOT NULL DEFAULT '[]'::jsonb,
    schedule jsonb NOT NULL DEFAULT '[]'::jsonb,
    conditions text,
    shift_delays jsonb NOT NULL DEFAULT '{}'::jsonb,
    share_token text UNIQUE,
    is_public boolean NOT NULL DEFAULT false,
    published_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE coupons (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code text NOT NULL UNIQUE,
    discount_percent integer NOT NULL CHECK (discount_percent BETWEEN 1 AND 100),
    valid_from timestamptz NOT NULL DEFAULT now(),
    valid_until timestamptz,
    max_uses integer NOT NULL DEFAULT 0,
    current_uses integer NOT NULL DEFAULT 0,
    applicable_plans text[] NOT NULL DEFAULT ARRAY['INDIVIDUAL', 'BUSINESS'],
    created_by uuid REFERENCES admins(id) ON DELETE SET NULL,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE orders (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id text NOT NULL REFERENCES profiles(id),
    plan text NOT NULL CHECK (plan IN ('INDIVIDUAL', 'BUSINESS')),
    billing_period text NOT NULL CHECK (billing_period IN ('monthly', 'yearly')),
    amount numeric(12, 2) NOT NULL,
    currency text NOT NULL DEFAULT 'TRY',
    coupon_id uuid REFERENCES coupons(id) ON DELETE SET NULL,
    status text NOT NULL DEFAULT 'pending',
    payment_provider text,
    payment_ref text,
    payment_provider_id text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX calendars_user_created_idx ON calendars(user_id, created_at DESC);
CREATE INDEX calendars_created_idx ON calendars(created_at DESC);
CREATE INDEX orders_user_created_idx ON orders(user_id, created_at DESC);
CREATE INDEX orders_status_created_idx ON orders(status, created_at DESC);
CREATE INDEX profiles_created_idx ON profiles(created_at DESC);

COMMIT;
