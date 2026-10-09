import { User } from '../models/index.js';
import { generateTokens, verifyRefreshToken } from '../middleware/auth.js';
import jwt from 'jsonwebtoken';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

const cookieOptions = () => ({
  httpOnly: true, // not readable from JavaScript, so XSS can't steal it
  secure: config.refreshCookie.secure,
  sameSite: config.refreshCookie.sameSite,
  path: config.refreshCookie.path,
  domain: config.refreshCookie.domain,
});

// The cookie lives exactly as long as the refresh token inside it.
export const setRefreshCookie = (res, refreshToken) => {
  const { exp } = jwt.decode(refreshToken);
  res.cookie(config.refreshCookie.name, refreshToken, {
    ...cookieOptions(),
    maxAge: Math.max(exp * 1000 - Date.now(), 0),
  });
};

const clearRefreshCookie = (res) => res.clearCookie(config.refreshCookie.name, cookieOptions());

export const register = async (req, res) => {
  try {
    const { email, password, name, phone } = req.body;

    // Public registration only creates patients. Doctor/admin accounts are
    // created by the seed script or an existing admin — otherwise anyone
    // could self-register as admin.
    const role = 'patient';

    // Validation
    if (!email || !password || !name) {
      return res.status(400).json({ message: 'Email, password, and name are required' });
    }

    // Check if user exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(409).json({ message: 'User already exists' });
    }

    // Create user
    const user = new User({ email, password, name, role, ...(phone && { phone }) });
    await user.save();

    // Generate tokens
    const { accessToken, refreshToken } = generateTokens(user._id, user.role);

    logger.info(`User registered: ${email}`);

    setRefreshCookie(res, refreshToken);
    res.status(201).json({
      message: 'User registered successfully',
      token: accessToken,
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
    });
  } catch (error) {
    logger.error('Registration error:', error.message);
    res.status(500).json({ message: 'Registration failed', error: error.message });
  }
};

export const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validation
    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }

    // Find user
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    // Check password
    const isPasswordValid = await user.comparePassword(password);
    if (!isPasswordValid) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }
    if (!user.isActive) {
      return res.status(403).json({ message: 'This account has been deactivated' });
    }

    // Generate tokens
    const { accessToken, refreshToken } = generateTokens(user._id, user.role);

    logger.info(`User logged in: ${email}`);

    setRefreshCookie(res, refreshToken);
    res.status(200).json({
      message: 'Login successful',
      token: accessToken,
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
    });
  } catch (error) {
    logger.error('Login error:', error.message);
    res.status(500).json({ message: 'Login failed', error: error.message });
  }
};

export const refreshToken = async (req, res) => {
  try {
    const token = req.cookies?.[config.refreshCookie.name];

    if (!token) {
      return res.status(401).json({ message: 'Refresh cookie is missing; please log in again' });
    }

    // Verify refresh token
    const decoded = verifyRefreshToken(token);
    if (!decoded) {
      clearRefreshCookie(res);
      return res.status(403).json({ message: 'Invalid or expired refresh token' });
    }

    // Look up user to get current role (role can change since the token was issued)
    const user = await User.findById(decoded.userId);
    if (!user || !user.isActive) {
      clearRefreshCookie(res);
      return res.status(403).json({ message: 'User not found or inactive' });
    }

    // Issue a new access + refresh token pair
    const { accessToken, refreshToken: newRefreshToken } = generateTokens(user._id, user.role);

    logger.info(`Token refreshed for user: ${user.email}`);

    // Rotate: every refresh replaces the cookie with a fresh refresh token.
    setRefreshCookie(res, newRefreshToken);
    res.status(200).json({
      message: 'Token refreshed',
      token: accessToken,
      user: { id: user._id, email: user.email, name: user.name, role: user.role },
    });
  } catch (error) {
    logger.error('Token refresh error:', error.message);
    res.status(500).json({ message: 'Token refresh failed' });
  }
};

// POST /api/auth/logout — drop the refresh cookie. The short-lived access
// token simply expires.
export const logout = (req, res) => {
  clearRefreshCookie(res);
  res.json({ message: 'Logged out' });
};
