import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import sql from '../db.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// User registration
router.post('/register', async (req, res) => {
  try {
    const { email, password, firstName, lastName, role = 'radiologist' } = req.body;
    
    // Validation
    if (!email || !password || !firstName || !lastName) {
      return res.status(400).json({ error: 'All fields are required' });
    }
    
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }
    
    // Check if user already exists
    const [existingUser] = await sql`
      SELECT id FROM users WHERE email = ${email}
    `;
    
    if (existingUser) {
      return res.status(400).json({ error: 'User with this email already exists' });
    }
    
    // Hash password
    const saltRounds = 12;
    const passwordHash = await bcrypt.hash(password, saltRounds);
    
    // Create user
    const [newUser] = await sql`
      INSERT INTO users (email, password_hash, first_name, last_name, role)
      VALUES (${email}, ${passwordHash}, ${firstName}, ${lastName}, ${role})
      RETURNING id, email, first_name, last_name, role, created_at
    `;
    
    // Create user profile
    await sql`
      INSERT INTO user_profiles (user_id)
      VALUES (${newUser.id})
    `;
    
    // Generate JWT token
    const token = jwt.sign(
      { userId: newUser.id, email: newUser.email },
      process.env.JWT_SECRET || '97506023ac7e2d8a9f936d36f3abd380',
      { expiresIn: '7d' }
    );
    
    // Hash token for storage
    const tokenHash = await bcrypt.hash(token, 10);
    
    // Store session
    await sql`
      INSERT INTO user_sessions (user_id, token_hash, expires_at)
      VALUES (${newUser.id}, ${tokenHash}, NOW() + INTERVAL '7 days')
    `;
    
    res.status(201).json({
      message: 'User registered successfully',
      user: {
        id: newUser.id,
        email: newUser.email,
        firstName: newUser.first_name,
        lastName: newUser.last_name,
        role: newUser.role
      },
      token: token
    });
    
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Registration failed' });
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
    
    // Find user
    const [user] = await sql`
      SELECT id, email, password_hash, first_name, last_name, role, is_active
      FROM users WHERE email = ${email}
    `;
    
    if (!user || !user.is_active) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.password_hash);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    // Generate JWT token
    const token = jwt.sign(
      { userId: user.id, email: user.email },
      process.env.JWT_SECRET || '97506023ac7e2d8a9f936d36f3abd380',
      { expiresIn: '7d' }
    );
    
    // Hash token for storage
    const tokenHash = await bcrypt.hash(token, 10);
    
    // Store session
    await sql`
      INSERT INTO user_sessions (user_id, token_hash, expires_at)
      VALUES (${user.id}, ${tokenHash}, NOW() + INTERVAL '7 days')
    `;
    
    res.json({
      message: 'Login successful',
      user: {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        role: user.role
      },
      token: token
    });
    
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Get user profile
router.get('/profile', authenticateToken, async (req, res) => {
  try {
    const [profile] = await sql`
      SELECT u.id, u.email, u.first_name, u.last_name, u.role, u.created_at,
             up.specialization, up.license_number, up.hospital, up.department, up.phone
      FROM users u
      LEFT JOIN user_profiles up ON u.id = up.user_id
      WHERE u.id = ${req.user.id}
    `;
    
    if (!profile) {
      return res.status(404).json({ error: 'Profile not found' });
    }
    
    res.json({ profile });
  } catch (error) {
    console.error('Profile fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

// Update user profile
router.put('/profile', authenticateToken, async (req, res) => {
  try {
    const { firstName, lastName, specialization, licenseNumber, hospital, department, phone } = req.body;
    
    // Update users table
    await sql`
      UPDATE users 
      SET first_name = ${firstName}, last_name = ${lastName}, updated_at = NOW()
      WHERE id = ${req.user.id}
    `;
    
    // Update user_profiles table
    await sql`
      UPDATE user_profiles 
      SET specialization = ${specialization}, license_number = ${licenseNumber}, 
          hospital = ${hospital}, department = ${department}, phone = ${phone}, 
          updated_at = NOW()
      WHERE user_id = ${req.user.id}
    `;
    
    res.json({ message: 'Profile updated successfully' });
  } catch (error) {
    console.error('Profile update error:', error);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// User logout
router.post('/logout', authenticateToken, async (req, res) => {
  try {
    const token = req.headers['authorization'].split(' ')[1];
    
    // Remove session
    await sql`
      DELETE FROM user_sessions 
      WHERE user_id = ${req.user.id} 
      AND token_hash = crypt(${token}, token_hash)
    `;
    
    res.json({ message: 'Logout successful' });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ error: 'Logout failed' });
  }
});

export default router;
