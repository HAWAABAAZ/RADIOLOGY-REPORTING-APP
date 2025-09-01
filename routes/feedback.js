import express from 'express';
import { supabase } from '../lib/supabase.js';
import { authenticateSupabase } from '../middleware/supabase-auth.js';

function isEmailAllowlisted(email) {
  try {
    const list = (process.env.ADMIN_EMAILS || '').split(',').map(v => v.trim().toLowerCase()).filter(Boolean);
    return email && list.includes(email.toLowerCase());
  } catch (_) { return false; }
}
const router = express.Router();

// Submit anonymous feedback
router.post('/submit', async (req, res) => {
  try {
    const { feedback_text, rating, category = 'general' } = req.body;
    
    if (!feedback_text || feedback_text.trim().length === 0) {
      return res.status(400).json({ error: 'Feedback text is required' });
    }
    
    if (rating && (rating < 1 || rating > 5)) {
      return res.status(400).json({ error: 'Rating must be between 1 and 5' });
    }
    
    // Get client info
    const user_agent = req.get('User-Agent');
    const ip_address = req.ip || req.connection.remoteAddress;
    
    const { data, error } = await supabase
      .from('feedback')
      .insert([{
        feedback_text: feedback_text.trim(),
        rating: rating || null,
        category,
        user_agent,
        ip_address
      }])
      .select()
      .single();
    
    if (error) {
      console.error('Error submitting feedback:', error);
      return res.status(500).json({ error: 'Failed to submit feedback' });
    }
    
    res.status(201).json({ 
      message: 'Feedback submitted successfully',
      id: data.id 
    });
    
  } catch (error) {
    console.error('Error in feedback submission:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get all feedback (admin only)
router.get('/all', authenticateSupabase, async (req, res) => {
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
      page = 1, 
      limit = 20, 
      category, 
      rating, 
      is_resolved,
      sort_by = 'created_at',
      sort_order = 'desc'
    } = req.query;
    
    let query = supabase
      .from('feedback')
      .select('*', { count: 'exact' });
    
    // Apply filters
    if (category && category !== 'all') {
      query = query.eq('category', category);
    }
    
    if (rating) {
      query = query.eq('rating', parseInt(rating));
    }
    
    if (is_resolved !== undefined) {
      query = query.eq('is_resolved', is_resolved === 'true');
    }
    
    // Apply sorting
    query = query.order(sort_by, { ascending: sort_order === 'asc' });
    
    // Apply pagination
    const offset = (parseInt(page) - 1) * parseInt(limit);
    query = query.range(offset, offset + parseInt(limit) - 1);
    
    const { data, error, count } = await query;
    
    if (error) {
      console.error('Error fetching feedback:', error);
      return res.status(500).json({ error: 'Failed to fetch feedback' });
    }
    
    res.json({
      feedback: data,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: count,
        pages: Math.ceil(count / parseInt(limit))
      }
    });
    
  } catch (error) {
    console.error('Error in feedback retrieval:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update feedback status (admin only)
router.patch('/:id', authenticateSupabase, async (req, res) => {
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
    
    const { id } = req.params;
    const { is_resolved, admin_notes } = req.body;
    
    const updateData = {};
    if (is_resolved !== undefined) updateData.is_resolved = is_resolved;
    if (admin_notes !== undefined) updateData.admin_notes = admin_notes;
    
    const { data, error } = await supabase
      .from('feedback')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();
    
    if (error) {
      console.error('Error updating feedback:', error);
      return res.status(500).json({ error: 'Failed to update feedback' });
    }
    
    if (!data) {
      return res.status(404).json({ error: 'Feedback not found' });
    }
    
    res.json({ message: 'Feedback updated successfully', feedback: data });
    
  } catch (error) {
    console.error('Error in feedback update:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get feedback statistics (admin only)
router.get('/stats', authenticateSupabase, async (req, res) => {
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
    
    // Get overall stats
    const { data: totalStats, error: totalError } = await supabase
      .from('feedback')
      .select('id, rating, category, is_resolved, created_at');
    
    if (totalError) {
      console.error('Error fetching feedback stats:', totalError);
      return res.status(500).json({ error: 'Failed to fetch feedback statistics' });
    }
    
    // Calculate statistics
    const stats = {
      total: totalStats.length,
      resolved: totalStats.filter(f => f.is_resolved).length,
      unresolved: totalStats.filter(f => !f.is_resolved).length,
      by_category: {},
      by_rating: {},
      recent: {
        today: 0,
        this_week: 0,
        this_month: 0
      },
      average_rating: 0
    };
    
    // Calculate category and rating distributions
    totalStats.forEach(feedback => {
      // Category stats
      stats.by_category[feedback.category] = (stats.by_category[feedback.category] || 0) + 1;
      
      // Rating stats
      if (feedback.rating) {
        stats.by_rating[feedback.rating] = (stats.by_rating[feedback.rating] || 0) + 1;
      }
      
      // Recent stats
      const createdAt = new Date(feedback.created_at);
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
      const monthAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
      
      if (createdAt >= today) stats.recent.today++;
      if (createdAt >= weekAgo) stats.recent.this_week++;
      if (createdAt >= monthAgo) stats.recent.this_month++;
    });
    
    // Calculate average rating
    const ratingsWithValues = totalStats.filter(f => f.rating);
    if (ratingsWithValues.length > 0) {
      stats.average_rating = ratingsWithValues.reduce((sum, f) => sum + f.rating, 0) / ratingsWithValues.length;
      stats.average_rating = Math.round(stats.average_rating * 100) / 100; // Round to 2 decimal places
    }
    
    res.json(stats);
    
  } catch (error) {
    console.error('Error in feedback stats:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
