import express from 'express';
import { supabase, supabaseAdmin } from '../lib/supabase.js';

const router = express.Router();

// User registration
router.post('/register', async (req, res) => {
  try {
    const { email, password, firstName = '', lastName = '', role = 'radiologist' } = req.body;
    
    // Validation
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }
    
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
    
    // Register user with Supabase
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          first_name: firstName,
          last_name: lastName,
          role: role
        },
        emailRedirectTo: `${req.headers.origin || 'http://localhost:3000'}/auth/callback`
      }
    });
    
    if (authError) {
      console.error('Supabase registration error:', authError);
      throw authError;
    }
    
    // Check if email confirmation is required
    if (authData.user) {
      // Always create user profile using admin client to bypass RLS
      const { error: profileError } = await supabaseAdmin
        .from('user_profiles')
        .insert([
          {
            user_id: authData.user.id,
            first_name: firstName || 'User',
            last_name: lastName || 'User',
            role: role
          }
        ]);
      
      if (profileError) {
        console.error('Profile creation error:', profileError);
        // Don't fail registration if profile creation fails
      }
      
      if (!authData.user.email_confirmed_at) {
        // Email confirmation required
        res.status(200).json({
          message: 'Registration successful! Please check your email to confirm your account.',
          requiresEmailConfirmation: true,
          user: {
            id: authData.user.id,
            email: authData.user.email,
            emailConfirmed: false
          }
        });
      } else {
        // Email already confirmed
        res.status(201).json({
          message: 'User registered and confirmed successfully',
          user: {
            id: authData.user.id,
            email: authData.user.email,
            firstName,
            lastName,
            role,
            emailConfirmed: true
          }
        });
      }
    } else {
      throw new Error('Registration failed - no user data returned');
    }
    
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: error.message || 'Registration failed' });
  }
});

// User login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    // Validation
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }
    
    // Sign in with Supabase
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password
    });
    
    if (error) {
      throw error;
    }
    
    // Debug log to check session data
    console.log('Login successful for:', data.user.email);
    console.log('Session exists:', !!data.session);
    console.log('Access token exists:', !!data.session?.access_token);
    
    // Get user profile
    let { data: profile, error: profileError } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('user_id', data.user.id)
      .single();
    
    // If profile doesn't exist, create a default one
    if (profileError && profileError.code === 'PGRST116') {
      console.log('Profile not found, creating default profile for user:', data.user.id);
      
      const { data: newProfile, error: createError } = await supabaseAdmin
        .from('user_profiles')
        .insert([
          {
            user_id: data.user.id,
            first_name: 'User',
            last_name: 'User',
            role: 'radiologist'
          }
        ])
        .select()
        .single();
      
      if (createError) {
        console.error('Failed to create default profile:', createError);
        // Continue with login even if profile creation fails
        profile = null;
      } else {
        profile = newProfile;
      }
    } else if (profileError) {
      console.error('Profile fetch error:', profileError);
      // Continue with login even if profile fetch fails
      profile = null;
    }
    
    // Ensure proper JSON response with explicit content type
    res.status(200).json({
      message: 'Login successful',
      user: {
        id: data.user.id,
        email: data.user.email,
        firstName: profile?.first_name || 'User',
        lastName: profile?.last_name || 'User',
        role: profile?.role || 'radiologist'
      },
      access_token: data.session?.access_token,
      refresh_token: data.session?.refresh_token,
      success: true
    });
    
  } catch (error) {
    console.error('Login error:', error);
    console.error('Error details:', {
      message: error.message,
      code: error.code,
      status: error.status,
      details: error.details
    });
    
    // Handle specific Supabase errors
    if (error.message === 'Invalid login credentials') {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    
    // Handle email confirmation error
    if (error.message === 'Email not confirmed') {
      return res.status(401).json({ 
        error: 'Please confirm your email before logging in',
        requiresEmailConfirmation: true 
      });
    }
    
    res.status(500).json({ error: error.message || 'Login failed' });
  }
});

// Get user profile
router.get('/profile', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }
    
    // Verify token with Supabase
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError) {
      throw authError;
    }
    
    // Get user profile
    const { data: profile, error: profileError } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('user_id', user.id)
      .single();
    
    if (profileError) {
      throw profileError;
    }
    
    res.json({ profile });
  } catch (error) {
    console.error('Profile fetch error:', error);
    res.status(401).json({ error: error.message || 'Failed to fetch profile' });
  }
});

// Update user profile
router.put('/profile', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }
    
    // Verify token with Supabase
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError) {
      throw authError;
    }
    
    const { firstName, lastName, specialization, licenseNumber, hospital, department, phone } = req.body;
    
    // Update user profile
    const { error: updateError } = await supabase
      .from('user_profiles')
      .update({
        first_name: firstName,
        last_name: lastName,
        specialization,
        license_number: licenseNumber,
        hospital,
        department,
        phone,
        updated_at: new Date()
      })
      .eq('user_id', user.id);
    
    if (updateError) {
      throw updateError;
    }
    
    res.json({ message: 'Profile updated successfully' });
  } catch (error) {
    console.error('Profile update error:', error);
    res.status(500).json({ error: error.message || 'Failed to update profile' });
  }
});

// Email confirmation endpoint
router.post('/confirm-email', async (req, res) => {
  try {
    const { token_hash, type } = req.body;
    
    if (!token_hash || !type) {
      return res.status(400).json({ error: 'Token hash and type are required' });
    }
    
    // Verify the email confirmation
    const { data, error } = await supabase.auth.verifyOtp({
      token_hash,
      type: 'email'
    });
    
    if (error) {
      throw error;
    }
    
    if (data.user && data.user.email_confirmed_at) {
      // Create user profile after email confirmation using admin client
      const { error: profileError } = await supabaseAdmin
        .from('user_profiles')
        .insert([
          {
            user_id: data.user.id,
            first_name: data.user.user_metadata?.first_name || 'User',
            last_name: data.user.user_metadata?.last_name || 'User',
            role: data.user.user_metadata?.role || 'radiologist'
          }
        ]);
      
      if (profileError) {
        console.error('Profile creation error:', profileError);
        // Don't fail the confirmation, just log the error
      }
      
      res.json({
        message: 'Email confirmed successfully! You can now log in.',
        user: {
          id: data.user.id,
          email: data.user.email,
          emailConfirmed: true
        }
      });
    } else {
      res.status(400).json({ error: 'Email confirmation failed' });
    }
    
  } catch (error) {
    console.error('Email confirmation error:', error);
    res.status(500).json({ error: 'Email confirmation failed' });
  }
});



// Get current user info
router.get('/me', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Access token required' });
    }
    
    const token = authHeader.substring(7);
    const { data: { user }, error } = await supabase.auth.getUser(token);
    
    if (error || !user) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
    
    // Get user profile
    const { data: profile, error: profileError } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('user_id', user.id)
      .single();
    
    if (profileError && profileError.code !== 'PGRST116') {
      console.error('Profile fetch error:', profileError);
    }
    
    res.json({
      user: {
        id: user.id,
        email: user.email,
        emailConfirmed: user.email_confirmed_at ? true : false,
        firstName: profile?.first_name || '',
        lastName: profile?.last_name || '',
        role: profile?.role || 'user',
        specialization: profile?.specialization || '',
        hospital: profile?.hospital || '',
        department: profile?.department || ''
      }
    });
    
  } catch (error) {
    console.error('Get user info error:', error);
    res.status(500).json({ error: 'Failed to get user info' });
  }
});

// Development login - bypasses email confirmation (REMOVE IN PRODUCTION)
router.post('/dev-login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }
    
    // For development only - create a test session
    if (email === 'test@example.com' && password === 'test123') {
      const mockUser = {
        id: 'dev-user-123',
        email: 'test@example.com',
        firstName: 'Test',
        lastName: 'User',
        role: 'radiologist'
      };
      
      return res.status(200).json({
        message: 'Development login successful',
        user: mockUser,
        access_token: 'dev-token-123',
        refresh_token: 'dev-refresh-123',
        success: true
      });
    }
    
    return res.status(401).json({ error: 'Invalid dev credentials' });
  } catch (error) {
    res.status(500).json({ error: 'Dev login failed' });
  }
});

// User logout
router.post('/logout', async (req, res) => {
  try {
    const { error } = await supabase.auth.signOut();
    if (error) {
      throw error;
    }
    
    res.json({ message: 'Logout successful' });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ error: error.message || 'Logout failed' });
  }
});

export default router;
