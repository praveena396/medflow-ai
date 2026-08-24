import { User } from '../models/index.js';
import { generateTokens, verifyRefreshToken } from '../middleware/auth.js';
import { logger } from '../utils/logger.js';

export const register = async (req, res) => {
  try {
    const { email, password, name } = req.body;

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
    const user = new User({ email, password, name, role });
    await user.save();

    // Generate tokens
    const { accessToken, refreshToken } = generateTokens(user._id, user.role);

    logger.info(`User registered: ${email}`);

    res.status(201).json({
      message: 'User registered successfully',
      token: accessToken,
      refreshToken,
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

    // Generate tokens
    const { accessToken, refreshToken } = generateTokens(user._id, user.role);

    logger.info(`User logged in: ${email}`);

    res.status(200).json({
      message: 'Login successful',
      token: accessToken,
      refreshToken,
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
    const { refreshToken: token } = req.body;

    if (!token) {
      return res.status(400).json({ message: 'Refresh token is required' });
    }

    // Verify refresh token
    const decoded = verifyRefreshToken(token);
    if (!decoded) {
      return res.status(403).json({ message: 'Invalid or expired refresh token' });
    }

    // Look up user to get current role (role can change since the token was issued)
    const user = await User.findById(decoded.userId);
    if (!user || !user.isActive) {
      return res.status(403).json({ message: 'User not found or inactive' });
    }

    // Issue a new access + refresh token pair
    const { accessToken, refreshToken: newRefreshToken } = generateTokens(user._id, user.role);

    logger.info(`Token refreshed for user: ${user.email}`);

    res.status(200).json({
      message: 'Token refreshed',
      token: accessToken,
      refreshToken: newRefreshToken,
    });
  } catch (error) {
    logger.error('Token refresh error:', error.message);
    res.status(500).json({ message: 'Token refresh failed' });
  }
};
