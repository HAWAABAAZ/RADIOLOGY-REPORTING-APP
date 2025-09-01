-- Feedback and Analytics Schema for Radiology App
-- This file contains the database schema for feedback system and user analytics

-- Feedback table for anonymous user feedback
CREATE TABLE IF NOT EXISTS feedback (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    feedback_text TEXT NOT NULL,
    rating INTEGER CHECK (rating >= 1 AND rating <= 5),
    category VARCHAR(50) DEFAULT 'general', -- general, bug, feature, ui, performance
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    user_agent TEXT,
    ip_address INET,
    is_resolved BOOLEAN DEFAULT FALSE,
    admin_notes TEXT
);

-- User activity tracking table
CREATE TABLE IF NOT EXISTS user_activities (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    activity_type VARCHAR(50) NOT NULL, -- login, logout, report_generated, template_used, etc.
    activity_data JSONB, -- Additional data about the activity
    session_id VARCHAR(255),
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- User sessions table for tracking active users
CREATE TABLE IF NOT EXISTS user_sessions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    session_id VARCHAR(255) UNIQUE NOT NULL,
    started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_activity TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    ended_at TIMESTAMP WITH TIME ZONE,
    ip_address INET,
    user_agent TEXT,
    is_active BOOLEAN DEFAULT TRUE
);

-- Daily user statistics (aggregated data)
CREATE TABLE IF NOT EXISTS daily_user_stats (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    date DATE NOT NULL UNIQUE,
    total_users INTEGER DEFAULT 0,
    new_users INTEGER DEFAULT 0,
    active_users INTEGER DEFAULT 0,
    total_logins INTEGER DEFAULT 0,
    total_reports_generated INTEGER DEFAULT 0,
    total_templates_used INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Admin users table
CREATE TABLE IF NOT EXISTS admin_users (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
    role VARCHAR(50) DEFAULT 'admin', -- admin, super_admin
    permissions JSONB DEFAULT '["view_feedback", "view_analytics", "manage_users"]'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by UUID REFERENCES auth.users(id)
);

-- Indexes for better performance
CREATE INDEX IF NOT EXISTS idx_feedback_created_at ON feedback(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feedback_category ON feedback(category);
CREATE INDEX IF NOT EXISTS idx_feedback_rating ON feedback(rating);
CREATE INDEX IF NOT EXISTS idx_feedback_is_resolved ON feedback(is_resolved);

CREATE INDEX IF NOT EXISTS idx_user_activities_user_id ON user_activities(user_id);
CREATE INDEX IF NOT EXISTS idx_user_activities_created_at ON user_activities(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_activities_activity_type ON user_activities(activity_type);
CREATE INDEX IF NOT EXISTS idx_user_activities_session_id ON user_activities(session_id);

CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_session_id ON user_sessions(session_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_is_active ON user_sessions(is_active);
CREATE INDEX IF NOT EXISTS idx_user_sessions_last_activity ON user_sessions(last_activity DESC);

CREATE INDEX IF NOT EXISTS idx_daily_user_stats_date ON daily_user_stats(date DESC);

-- RLS (Row Level Security) policies
ALTER TABLE feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_user_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_users ENABLE ROW LEVEL SECURITY;

-- Feedback policies (anonymous access for creation, admin access for reading)
CREATE POLICY "Anyone can submit feedback" ON feedback
    FOR INSERT WITH CHECK (true);

CREATE POLICY "Admins can view all feedback" ON feedback
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM admin_users 
            WHERE user_id = auth.uid()
        )
    );

CREATE POLICY "Admins can update feedback" ON feedback
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM admin_users 
            WHERE user_id = auth.uid()
        )
    );

-- User activities policies
CREATE POLICY "Users can insert their own activities" ON user_activities
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view their own activities" ON user_activities
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Admins can view all activities" ON user_activities
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM admin_users 
            WHERE user_id = auth.uid()
        )
    );

-- User sessions policies
CREATE POLICY "Users can manage their own sessions" ON user_sessions
    FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Admins can view all sessions" ON user_sessions
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM admin_users 
            WHERE user_id = auth.uid()
        )
    );

-- Daily stats policies (admin only)
CREATE POLICY "Admins can view daily stats" ON daily_user_stats
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM admin_users 
            WHERE user_id = auth.uid()
        )
    );

CREATE POLICY "Admins can manage daily stats" ON daily_user_stats
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM admin_users 
            WHERE user_id = auth.uid()
        )
    );

-- Admin users policies
CREATE POLICY "Admins can view admin users" ON admin_users
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM admin_users 
            WHERE user_id = auth.uid()
        )
    );

-- Functions for analytics
CREATE OR REPLACE FUNCTION update_daily_stats()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    today_date DATE := CURRENT_DATE;
    stats_record RECORD;
BEGIN
    -- Calculate today's statistics
    SELECT 
        COUNT(DISTINCT u.id) as total_users,
        COUNT(DISTINCT CASE WHEN DATE(u.created_at) = today_date THEN u.id END) as new_users,
        COUNT(DISTINCT CASE WHEN DATE(ua.created_at) = today_date THEN ua.user_id END) as active_users,
        COUNT(CASE WHEN ua.activity_type = 'login' AND DATE(ua.created_at) = today_date THEN 1 END) as total_logins,
        COUNT(CASE WHEN ua.activity_type = 'report_generated' AND DATE(ua.created_at) = today_date THEN 1 END) as total_reports,
        COUNT(CASE WHEN ua.activity_type = 'template_used' AND DATE(ua.created_at) = today_date THEN 1 END) as total_templates
    INTO stats_record
    FROM auth.users u
    LEFT JOIN user_activities ua ON u.id = ua.user_id;
    
    -- Insert or update daily stats
    INSERT INTO daily_user_stats (
        date, total_users, new_users, active_users, 
        total_logins, total_reports_generated, total_templates_used, updated_at
    )
    VALUES (
        today_date, stats_record.total_users, stats_record.new_users, stats_record.active_users,
        stats_record.total_logins, stats_record.total_reports, stats_record.total_templates, NOW()
    )
    ON CONFLICT (date) 
    DO UPDATE SET
        total_users = EXCLUDED.total_users,
        new_users = EXCLUDED.new_users,
        active_users = EXCLUDED.active_users,
        total_logins = EXCLUDED.total_logins,
        total_reports_generated = EXCLUDED.total_reports_generated,
        total_templates_used = EXCLUDED.total_templates_used,
        updated_at = NOW();
END;
$$;

-- Function to track user activity
CREATE OR REPLACE FUNCTION track_user_activity(
    p_user_id UUID,
    p_activity_type VARCHAR(50),
    p_activity_data JSONB DEFAULT NULL,
    p_session_id VARCHAR(255) DEFAULT NULL,
    p_ip_address INET DEFAULT NULL,
    p_user_agent TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    activity_id UUID;
BEGIN
    INSERT INTO user_activities (
        user_id, activity_type, activity_data, session_id, ip_address, user_agent
    )
    VALUES (
        p_user_id, p_activity_type, p_activity_data, p_session_id, p_ip_address, p_user_agent
    )
    RETURNING id INTO activity_id;
    
    RETURN activity_id;
END;
$$;

-- Function to manage user sessions
CREATE OR REPLACE FUNCTION manage_user_session(
    p_user_id UUID,
    p_session_id VARCHAR(255),
    p_action VARCHAR(20), -- 'start', 'update', 'end'
    p_ip_address INET DEFAULT NULL,
    p_user_agent TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    session_record_id UUID;
BEGIN
    IF p_action = 'start' THEN
        -- End any existing active sessions for this user
        UPDATE user_sessions 
        SET is_active = FALSE, ended_at = NOW()
        WHERE user_id = p_user_id AND is_active = TRUE;
        
        -- Create new session
        INSERT INTO user_sessions (user_id, session_id, ip_address, user_agent)
        VALUES (p_user_id, p_session_id, p_ip_address, p_user_agent)
        RETURNING id INTO session_record_id;
        
    ELSIF p_action = 'update' THEN
        -- Update last activity
        UPDATE user_sessions 
        SET last_activity = NOW()
        WHERE session_id = p_session_id AND is_active = TRUE
        RETURNING id INTO session_record_id;
        
    ELSIF p_action = 'end' THEN
        -- End session
        UPDATE user_sessions 
        SET is_active = FALSE, ended_at = NOW()
        WHERE session_id = p_session_id AND is_active = TRUE
        RETURNING id INTO session_record_id;
    END IF;
    
    RETURN session_record_id;
END;
$$;

-- Create a default admin user (you'll need to update this with actual user ID)
-- INSERT INTO admin_users (user_id, role, permissions) 
-- VALUES ('your-admin-user-id-here', 'super_admin', '["view_feedback", "view_analytics", "manage_users", "manage_admins"]'::jsonb);

-- Comments for documentation
COMMENT ON TABLE feedback IS 'Stores anonymous user feedback with ratings and categories';
COMMENT ON TABLE user_activities IS 'Tracks all user activities for analytics';
COMMENT ON TABLE user_sessions IS 'Manages user sessions for live user tracking';
COMMENT ON TABLE daily_user_stats IS 'Aggregated daily statistics for dashboard';
COMMENT ON TABLE admin_users IS 'Defines admin users with specific permissions';
