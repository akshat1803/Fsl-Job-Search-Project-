const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../db');
require('dotenv').config();

// POST /api/auth/register - Register new user (candidate or company)
router.post('/register', async (req, res) => {
  const { first_name, last_name, email, password, role, mobile_no, company_name } = req.body;

  // Basic validation
  if (!first_name || !last_name || !email || !password) {
    return res.status(400).json({ success: false, message: 'First name, last name, email, and password are required' });
  }

  const userRole = role === 'company' ? 'company' : 'candidate';

  if (userRole === 'company' && !company_name) {
    return res.status(400).json({ success: false, message: 'Company name is required for registration as a company' });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // Check if email already exists
    const [existingUsers] = await connection.query('SELECT id FROM users WHERE email = ?', [email]);
    if (existingUsers.length > 0) {
      await connection.rollback();
      return res.status(400).json({ success: false, message: 'Email is already registered' });
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    // Insert user into users table
    const [userResult] = await connection.query(
      `INSERT INTO users (first_name, last_name, email, password_hash, mobile_no, role) 
       VALUES (?, ?, ?, ?, ?, ?)`,
      [first_name, last_name, email, passwordHash, mobile_no || null, userRole]
    );

    const userId = userResult.insertId;

    // Initialize profile based on role
    if (userRole === 'candidate') {
      await connection.query(
        'INSERT INTO candidates (user_id) VALUES (?)',
        [userId]
      );
    } else {
      await connection.query(
        'INSERT INTO companies (user_id, name) VALUES (?, ?)',
        [userId, company_name]
      );
    }

    await connection.commit();

    return res.status(201).json({
      success: true,
      message: 'User registered successfully',
      data: {
        userId,
        first_name,
        last_name,
        email,
        role: userRole
      }
    });
  } catch (error) {
    await connection.rollback();
    console.error('Registration Error:', error);
    return res.status(500).json({ success: false, message: 'Server error during registration' });
  } finally {
    connection.release();
  }
});

// POST /api/auth/login - Login, return JWT token
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ success: false, message: 'Email and password are required' });
  }

  try {
    // Fetch user details
    const [users] = await pool.query('SELECT * FROM users WHERE email = ?', [email]);
    if (users.length === 0) {
      return res.status(401).json({ success: false, message: 'Invalid email or password' });
    }

    const user = users[0];

    // Verify password
    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Invalid email or password' });
    }

    // Get role-specific ID
    let candidateId = null;
    let companyId = null;

    if (user.role === 'candidate') {
      const [candidates] = await pool.query('SELECT id FROM candidates WHERE user_id = ?', [user.id]);
      if (candidates.length > 0) {
        candidateId = candidates[0].id;
      }
    } else if (user.role === 'company') {
      const [companies] = await pool.query('SELECT id FROM companies WHERE user_id = ?', [user.id]);
      if (companies.length > 0) {
        companyId = companies[0].id;
      }
    }

    // Create JWT Token
    const payload = {
      id: user.id,
      email: user.email,
      role: user.role,
      candidateId,
      companyId
    };

    const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '24h' });

    return res.json({
      success: true,
      message: 'Login successful',
      data: {
        token,
        user: {
          id: user.id,
          first_name: user.first_name,
          last_name: user.last_name,
          email: user.email,
          role: user.role,
          candidateId,
          companyId
        }
      }
    });
  } catch (error) {
    console.error('Login Error:', error);
    return res.status(500).json({ success: false, message: 'Server error during login' });
  }
});

module.exports = router;
