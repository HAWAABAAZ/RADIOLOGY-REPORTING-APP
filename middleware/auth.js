import jwt from 'jsonwebtoken';
import sql from '../db.js';

export const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN
    
    if (!token) {
      return res.status(401).json({ error: 'Access token required' });
    }
    
    // Verify JWT token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Check if token exists in database and is not expired
    const [session] = await sql`
      SELECT us.*, u.email, u.first_name, u.last_name, u.role, u.is_active
      FROM user_sessions us
      JOIN users u ON us.user_id = u.id
      WHERE us.token_hash = crypt(${token}, us.token_hash)
      AND us.expires_at > NOW()
      AND u.is_active = true
    `;
    
    if (!session) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
    
    // Add user info to request
    req.user = {
      id: session.user_id,
      email: session.email,
      firstName: session.first_name,
      lastName: session.last_name,
      role: session.role
    };
    
    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ error: 'Invalid token' });
    }
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired' });
    }
    console.error('Auth middleware error:', error);
    return res.status(500).json({ error: 'Authentication failed' });
  }
};

export const requireRole = (roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    
    next();
  };
};
