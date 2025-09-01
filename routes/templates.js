import express from 'express';
import { supabase, supabaseAdmin } from '../lib/supabase.js';
import { authenticateSupabase } from '../middleware/supabase-auth.js';

const router = express.Router();

// GET /api/templates - Get all templates for authenticated user
router.get('/', authenticateSupabase, async (req, res) => {
  try {
    const { modality, body_part, search } = req.query;
    
    let query = supabase
      .from('templates')
      .select('*')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false });
    
    // Filter by modality if provided
    if (modality) {
      query = query.eq('modality', modality);
    }
    
    // Filter by body part if provided
    if (body_part) {
      query = query.eq('body_part', body_part);
    }
    
    // Search by name or description if provided
    if (search) {
      query = query.or(`name.ilike.%${search}%,description.ilike.%${search}%`);
    }
    
    const { data: templates, error } = await query;
    
    if (error) {
      console.error('Error fetching templates:', error);
      return res.status(500).json({ error: 'Failed to fetch templates' });
    }
    
    res.json({ templates: templates || [] });
    
  } catch (error) {
    console.error('Template fetch error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/templates/:id - Get specific template by ID
router.get('/:id', authenticateSupabase, async (req, res) => {
  try {
    const { id } = req.params;
    
    const { data: template, error } = await supabase
      .from('templates')
      .select('*')
      .eq('id', id)
      .eq('user_id', req.user.id)
      .single();
    
    if (error) {
      if (error.code === 'PGRST116') {
        return res.status(404).json({ error: 'Template not found' });
      }
      console.error('Error fetching template:', error);
      return res.status(500).json({ error: 'Failed to fetch template' });
    }
    
    res.json({ template });
    
  } catch (error) {
    console.error('Template fetch error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/templates - Create new template
router.post('/', authenticateSupabase, async (req, res) => {
  try {
    const { name, content, description, modality, body_part, tags, is_default } = req.body;
    
    // Validation
    if (!name || !content) {
      return res.status(400).json({ error: 'Name and content are required' });
    }
    
    // If setting as default, unset other defaults for this user
    if (is_default) {
      await supabase
        .from('templates')
        .update({ is_default: false })
        .eq('user_id', req.user.id)
        .eq('is_default', true);
    }
    
    const { data: template, error } = await supabase
      .from('templates')
      .insert({
        user_id: req.user.id,
        name,
        content,
        description: description || '',
        modality: modality || '',
        body_part: body_part || '',
        tags: tags || [],
        is_default: is_default || false
      })
      .select()
      .single();
    
    if (error) {
      console.error('Error creating template:', error);
      return res.status(500).json({ error: 'Failed to create template' });
    }
    
    res.status(201).json({ 
      message: 'Template created successfully',
      template 
    });
    
  } catch (error) {
    console.error('Template creation error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/templates/:id - Update existing template
router.put('/:id', authenticateSupabase, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, content, description, modality, body_part, tags, is_default } = req.body;
    
    // Check if template exists and belongs to user
    const { data: existingTemplate, error: fetchError } = await supabase
      .from('templates')
      .select('id')
      .eq('id', id)
      .eq('user_id', req.user.id)
      .single();
    
    if (fetchError || !existingTemplate) {
      return res.status(404).json({ error: 'Template not found' });
    }
    
    // If setting as default, unset other defaults for this user
    if (is_default) {
      await supabase
        .from('templates')
        .update({ is_default: false })
        .eq('user_id', req.user.id)
        .eq('is_default', true)
        .neq('id', id);
    }
    
    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (content !== undefined) updateData.content = content;
    if (description !== undefined) updateData.description = description;
    if (modality !== undefined) updateData.modality = modality;
    if (body_part !== undefined) updateData.body_part = body_part;
    if (tags !== undefined) updateData.tags = tags;
    if (is_default !== undefined) updateData.is_default = is_default;
    
    const { data: template, error } = await supabase
      .from('templates')
      .update(updateData)
      .eq('id', id)
      .eq('user_id', req.user.id)
      .select()
      .single();
    
    if (error) {
      console.error('Error updating template:', error);
      return res.status(500).json({ error: 'Failed to update template' });
    }
    
    res.json({ 
      message: 'Template updated successfully',
      template 
    });
    
  } catch (error) {
    console.error('Template update error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/templates/:id - Delete template
router.delete('/:id', authenticateSupabase, async (req, res) => {
  try {
    const { id } = req.params;
    
    // Check if template exists and belongs to user
    const { data: existingTemplate, error: fetchError } = await supabase
      .from('templates')
      .select('id')
      .eq('id', id)
      .eq('user_id', req.user.id)
      .single();
    
    if (fetchError || !existingTemplate) {
      return res.status(404).json({ error: 'Template not found' });
    }
    
    const { error } = await supabase
      .from('templates')
      .delete()
      .eq('id', id)
      .eq('user_id', req.user.id);
    
    if (error) {
      console.error('Error deleting template:', error);
      return res.status(500).json({ error: 'Failed to delete template' });
    }
    
    res.json({ message: 'Template deleted successfully' });
    
  } catch (error) {
    console.error('Template deletion error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/templates/default - Get user's default template
router.get('/default', authenticateSupabase, async (req, res) => {
  try {
    const { data: template, error } = await supabase
      .from('templates')
      .select('*')
      .eq('user_id', req.user.id)
      .eq('is_default', true)
      .single();
    
    if (error) {
      if (error.code === 'PGRST116') {
        return res.json({ template: null });
      }
      console.error('Error fetching default template:', error);
      return res.status(500).json({ error: 'Failed to fetch default template' });
    }
    
    res.json({ template });
    
  } catch (error) {
    console.error('Default template fetch error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/templates/:id/set-default - Set template as default
router.post('/:id/set-default', authenticateSupabase, async (req, res) => {
  try {
    const { id } = req.params;
    
    // Check if template exists and belongs to user
    const { data: existingTemplate, error: fetchError } = await supabase
      .from('templates')
      .select('id')
      .eq('id', id)
      .eq('user_id', req.user.id)
      .single();
    
    if (fetchError || !existingTemplate) {
      return res.status(404).json({ error: 'Template not found' });
    }
    
    // Unset all other defaults for this user
    await supabase
      .from('templates')
      .update({ is_default: false })
      .eq('user_id', req.user.id)
      .eq('is_default', true);
    
    // Set this template as default
    const { data: template, error } = await supabase
      .from('templates')
      .update({ is_default: true })
      .eq('id', id)
      .eq('user_id', req.user.id)
      .select()
      .single();
    
    if (error) {
      console.error('Error setting default template:', error);
      return res.status(500).json({ error: 'Failed to set default template' });
    }
    
    res.json({ 
      message: 'Default template set successfully',
      template 
    });
    
  } catch (error) {
    console.error('Set default template error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
