import { database } from '../lib/database.js';

// Middleware to authenticate requests using Database
export const authenticateDatabase = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    console.log('[AUTH] Headers received:', {
      authorization: authHeader ? 'Bearer ***' : 'None',
      contentType: req.headers['content-type'],
      origin: req.headers.origin
    });
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      console.log('[AUTH] Missing or invalid authorization header');
      return res.status(401).json({ error: 'Access token required' });
    }
    
    const token = authHeader.substring(7); // Remove 'Bearer ' prefix
    
    // Verify the token with Database
    const { data: { user }, error } = await database.auth.getUser(token);
    
    if (error || !user) {
      console.error('[AUTH] Token verification failed:', error?.message || 'No user returned');
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
    
    console.log('[AUTH] User authenticated:', user.email);
    
    // Add user info to request object
    req.user = user;
    next();
  } catch (error) {
    console.error('[AUTH] Authentication error:', error);
    return res.status(500).json({ error: 'Authentication failed: ' + error.message });
  }
};

// Middleware to require specific roles
export const requireRole = (roles) => {
  return async (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Authentication required' });
      }
      
      // Get user profile to check role
      const { data: profile, error } = await database
        .from('user_profiles')
        .select('role')
        .eq('user_id', req.user.id)
        .single();
      
      if (error || !profile) {
        return res.status(403).json({ error: 'User profile not found' });
      }
      
      const userRole = profile.role;
      
      if (Array.isArray(roles) && !roles.includes(userRole)) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }
      
      if (typeof roles === 'string' && userRole !== roles) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }
      
      next();
    } catch (error) {
      console.error('Role check error:', error);
      return res.status(500).json({ error: 'Role verification failed' });
    }
  };
};
