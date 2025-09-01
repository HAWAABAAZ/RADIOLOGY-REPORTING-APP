import express from 'express';
import { supabase } from '../lib/supabase.js';
import { authenticateSupabase } from '../middleware/supabase-auth.js';
const router = express.Router();

// Track user activity
router.post('/track', authenticateSupabase, async (req, res) => {
  try {
    const { activity_type, activity_data, session_id } = req.body;
    
    if (!activity_type) {
      return res.status(400).json({ error: 'Activity type is required' });
    }
    
    const user_agent = req.get('User-Agent');
    const ip_address = req.ip || req.connection.remoteAddress;
    
    const { data, error } = await supabase
      .rpc('track_user_activity', {
        p_user_id: req.user.id,
        p_activity_type: activity_type,
        p_activity_data: activity_data || null,
        p_session_id: session_id || null,
        p_ip_address: ip_address,
        p_user_agent: user_agent
      });
    
    if (error) {
      console.error('Error tracking activity:', error);
      return res.status(500).json({ error: 'Failed to track activity' });
    }
    
    res.json({ message: 'Activity tracked successfully', id: data });
    
  } catch (error) {
    console.error('Error in activity tracking:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Manage user session
router.post('/session', authenticateSupabase, async (req, res) => {
  try {
    const { session_id, action } = req.body; // action: 'start', 'update', 'end'
    
    if (!session_id || !action) {
      return res.status(400).json({ error: 'Session ID and action are required' });
    }
    
    const user_agent = req.get('User-Agent');
    const ip_address = req.ip || req.connection.remoteAddress;
    
    const { data, error } = await supabase
      .rpc('manage_user_session', {
        p_user_id: req.user.id,
        p_session_id: session_id,
        p_action: action,
        p_ip_address: ip_address,
        p_user_agent: user_agent
      });
    
    if (error) {
      console.error('Error managing session:', error);
      return res.status(500).json({ error: 'Failed to manage session' });
    }
    
    res.json({ message: 'Session managed successfully', id: data });
    
  } catch (error) {
    console.error('Error in session management:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Helper to determine admin (env allowlist fallback)
function isEmailAllowlisted(email) {
  try {
    const list = (process.env.ADMIN_EMAILS || '').split(',').map(v => v.trim().toLowerCase()).filter(Boolean);
    return email && list.includes(email.toLowerCase());
  } catch (_) { return false; }
}

// Get user analytics dashboard (admin only)
router.get('/dashboard', authenticateSupabase, async (req, res) => {
  try {
    // Check if user is admin (DB row or allowlisted email)
    let isAdmin = false;
    if (isEmailAllowlisted(req.user.email)) {
      isAdmin = true;
    } else {
      const { data: adminUser, error: adminError } = await supabase
        .from('admin_users')
        .select('*')
        .eq('user_id', req.user.id)
        .single();
      if (!adminError && adminUser) isAdmin = true;
    }
    if (!isAdmin) return res.status(403).json({ error: 'Access denied. Admin privileges required.' });
    
    const { days = 30 } = req.query;
    
    // Get daily stats for the specified period
    const { data: dailyStats, error: dailyError } = await supabase
      .from('daily_user_stats')
      .select('*')
      .gte('date', new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0])
      .order('date', { ascending: false });
    
    if (dailyError) {
      console.error('Error fetching daily stats:', dailyError);
      return res.status(500).json({ error: 'Failed to fetch daily statistics' });
    }
    
    // Get current active users
    const { data: activeSessions, error: sessionError } = await supabase
      .from('user_sessions')
      .select('user_id, started_at, last_activity')
      .eq('is_active', true)
      .gte('last_activity', new Date(Date.now() - 30 * 60 * 1000).toISOString()); // Active in last 30 minutes
    
    if (sessionError) {
      console.error('Error fetching active sessions:', sessionError);
    }
    
    // Get recent user activities
    const { data: recentActivities, error: activityError } = await supabase
      .from('user_activities')
      .select(`
        id, activity_type, activity_data, created_at,
        user_id
      `)
      .order('created_at', { ascending: false })
      .limit(50);
    
    if (activityError) {
      console.error('Error fetching recent activities:', activityError);
    }
    
    // Calculate summary statistics
    const today = dailyStats.find(stat => stat.date === new Date().toISOString().split('T')[0]);
    const yesterday = dailyStats.find(stat => {
      const yesterdayDate = new Date();
      yesterdayDate.setDate(yesterdayDate.getDate() - 1);
      return stat.date === yesterdayDate.toISOString().split('T')[0];
    });
    
    const summary = {
      active_users_now: activeSessions ? activeSessions.length : 0,
      total_users_today: today ? today.total_users : 0,
      new_users_today: today ? today.new_users : 0,
      logins_today: today ? today.total_logins : 0,
      reports_generated_today: today ? today.total_reports_generated : 0,
      growth: {
        users: today && yesterday ? 
          ((today.total_users - yesterday.total_users) / yesterday.total_users * 100).toFixed(1) : 0,
        logins: today && yesterday ? 
          ((today.total_logins - yesterday.total_logins) / yesterday.total_logins * 100).toFixed(1) : 0
      }
    };
    
    res.json({
      summary,
      daily_stats: dailyStats,
      active_sessions: activeSessions || [],
      recent_activities: recentActivities || []
    });
    
  } catch (error) {
    console.error('Error in analytics dashboard:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get live users (admin only)
router.get('/live-users', authenticateSupabase, async (req, res) => {
  try {
    // Check if user is admin (DB row or allowlisted email)
    let isAdmin = false;
    if (isEmailAllowlisted(req.user.email)) {
      isAdmin = true;
    } else {
      const { data: adminUser, error: adminError } = await supabase
        .from('admin_users')
        .select('*')
        .eq('user_id', req.user.id)
        .single();
      if (!adminError && adminUser) isAdmin = true;
    }
    if (!isAdmin) return res.status(403).json({ error: 'Access denied. Admin privileges required.' });
    
    // Get active sessions with user details
    const { data: activeSessions, error } = await supabase
      .from('user_sessions')
      .select(`
        id, session_id, started_at, last_activity, ip_address, user_agent,
        user_id
      `)
      .eq('is_active', true)
      .gte('last_activity', new Date(Date.now() - 30 * 60 * 1000).toISOString()) // Active in last 30 minutes
      .order('last_activity', { ascending: false });
    
    if (error) {
      console.error('Error fetching live users:', error);
      return res.status(500).json({ error: 'Failed to fetch live users' });
    }
    
    // Get user emails for the active sessions
    const userIds = activeSessions.map(session => session.user_id);
    let userDetails = [];
    
    if (userIds.length > 0) {
      const { data: users, error: userError } = await supabase.auth.admin.listUsers();
      
      if (!userError) {
        userDetails = users.users.filter(user => userIds.includes(user.id));
      }
    }
    
    // Combine session data with user details
    const liveUsers = activeSessions.map(session => {
      const user = userDetails.find(u => u.id === session.user_id);
      return {
        ...session,
        user_email: user ? user.email : 'Unknown',
        user_created_at: user ? user.created_at : null,
        session_duration: Math.floor((new Date() - new Date(session.started_at)) / 1000 / 60) // in minutes
      };
    });
    
    res.json({
      count: liveUsers.length,
      users: liveUsers
    });
    
  } catch (error) {
    console.error('Error in live users:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update daily statistics (admin only - can be called manually or via cron)
router.post('/update-daily-stats', authenticateSupabase, async (req, res) => {
  try {
    // Check if user is admin (DB row or allowlisted email)
    let isAdmin = false;
    if (isEmailAllowlisted(req.user.email)) {
      isAdmin = true;
    } else {
      const { data: adminUser, error: adminError } = await supabase
        .from('admin_users')
        .select('*')
        .eq('user_id', req.user.id)
        .single();
      if (!adminError && adminUser) isAdmin = true;
    }
    if (!isAdmin) return res.status(403).json({ error: 'Access denied. Admin privileges required.' });
    
    const { error } = await supabase.rpc('update_daily_stats');
    
    if (error) {
      console.error('Error updating daily stats:', error);
      return res.status(500).json({ error: 'Failed to update daily statistics' });
    }
    
    res.json({ message: 'Daily statistics updated successfully' });
    
  } catch (error) {
    console.error('Error in daily stats update:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get user activity history (admin only)
router.get('/user-activities', authenticateSupabase, async (req, res) => {
  try {
    // Check if user is admin (DB row or allowlisted email)
    let isAdmin = false;
    if (isEmailAllowlisted(req.user.email)) {
      isAdmin = true;
    } else {
      const { data: adminUser, error: adminError } = await supabase
        .from('admin_users')
        .select('*')
        .eq('user_id', req.user.id)
        .single();
      if (!adminError && adminUser) isAdmin = true;
    }
    if (!isAdmin) return res.status(403).json({ error: 'Access denied. Admin privileges required.' });
    
    const { 
      user_id, 
      activity_type, 
      page = 1, 
      limit = 50,
      days = 7 
    } = req.query;
    
    let query = supabase
      .from('user_activities')
      .select('*', { count: 'exact' })
      .gte('created_at', new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString());
    
    if (user_id) {
      query = query.eq('user_id', user_id);
    }
    
    if (activity_type) {
      query = query.eq('activity_type', activity_type);
    }
    
    query = query.order('created_at', { ascending: false });
    
    const offset = (parseInt(page) - 1) * parseInt(limit);
    query = query.range(offset, offset + parseInt(limit) - 1);
    
    const { data, error, count } = await query;
    
    if (error) {
      console.error('Error fetching user activities:', error);
      return res.status(500).json({ error: 'Failed to fetch user activities' });
    }
    
    res.json({
      activities: data,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: count,
        pages: Math.ceil(count / parseInt(limit))
      }
    });
    
  } catch (error) {
    console.error('Error in user activities:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
