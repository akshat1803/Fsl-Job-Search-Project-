const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const pool = require('../db');
require('dotenv').config();

// POST /api/auth/register - Register new user (candidate or company)
router.post('/register', async (req, res) => {
  const { first_name, last_name, email, password, role, mobile_no, company_name } = req.body;

  // Normalize parameters (handling camelCase or snake_case inputs)
  const FirstName = first_name || req.body.FirstName;
  const LastName = last_name || req.body.LastName;
  const Email = email || req.body.Email;
  const Password = password || req.body.Password;
  const MobileNo = mobile_no || req.body.MobileNo;
  const Role = role || req.body.Role;
  const CompanyName = company_name || req.body.CompanyName;

  // Basic validation
  if (!FirstName || !LastName || !Email || !Password) {
    return res.status(400).json({ success: false, message: 'First name, last name, email, and password are required' });
  }

  // Automatically determine role based on presence of company_name
  let userRole = 2; // Default to Candidate
  if (CompanyName && CompanyName.trim() !== '') {
    userRole = 3; // Company
  } else if (Role === 'admin' || Role === 1) {
    userRole = 1; // Admin support
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // Check if email already exists (using PascalCase column)
    const [existingUsers] = await connection.query('SELECT Id FROM Users WHERE Email = ?', [Email]);
    if (existingUsers.length > 0) {
      await connection.rollback();
      return res.status(400).json({ success: false, message: 'Email is already registered' });
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(Password, salt);

    // Generate User UUID
    const userId = crypto.randomUUID();

    // Insert user into Users table
    await connection.query(
      `INSERT INTO Users (Id, FirstName, LastName, Email, PasswordHash, MobileNo, UserRole, IsActive) 
       VALUES (?, ?, ?, ?, ?, ?, ?, TRUE)`,
      [userId, FirstName, LastName, Email, passwordHash, MobileNo || null, userRole]
    );

    let candidateId = null;
    let companyId = null;

    // Initialize profile based on role
    if (userRole === 2) {
      candidateId = crypto.randomUUID();
      await connection.query(
        'INSERT INTO Candidate (Id, UserId, Visibility, IsActive) VALUES (?, ?, "public", TRUE)',
        [candidateId, userId]
      );
    } else if (userRole === 3) {
      companyId = crypto.randomUUID();
      await connection.query(
        'INSERT INTO Companies (Id, UserId, Name, IsActive) VALUES (?, ?, ?, TRUE)',
        [companyId, userId, CompanyName]
      );
    }

    await connection.commit();

    const roleName = userRole === 1 ? 'admin' : (userRole === 2 ? 'candidate' : 'company');

    return res.status(201).json({
      success: true,
      message: 'User registered successfully',
      data: {
        userId,
        candidateId,
        companyId,
        first_name: FirstName,
        last_name: LastName,
        email: Email,
        role: roleName
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
  const Email = req.body.email || req.body.Email;
  const Password = req.body.password || req.body.Password;

  if (!Email || !Password) {
    return res.status(400).json({ success: false, message: 'Email and password are required' });
  }

  try {
    // Fetch user details
    const [users] = await pool.query('SELECT * FROM Users WHERE Email = ? AND IsActive = TRUE', [Email]);
    if (users.length === 0) {
      return res.status(401).json({ success: false, message: 'Invalid email or password' });
    }

    const user = users[0];

    // Verify password
    const isMatch = await bcrypt.compare(Password, user.PasswordHash);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Invalid email or password' });
    }

    // Get role-specific ID
    let candidateId = null;
    let companyId = null;

    if (user.UserRole === 2) {
      const [candidates] = await pool.query('SELECT Id FROM Candidate WHERE UserId = ? AND IsActive = TRUE', [user.Id]);
      if (candidates.length > 0) {
        candidateId = candidates[0].Id;
      }
    } else if (user.UserRole === 3) {
      const [companies] = await pool.query('SELECT Id FROM Companies WHERE UserId = ? AND IsActive = TRUE', [user.Id]);
      if (companies.length > 0) {
        companyId = companies[0].Id;
      }
    }

    const roleName = user.UserRole === 1 ? 'admin' : (user.UserRole === 2 ? 'candidate' : 'company');

    // Create JWT Token
    const payload = {
      id: user.Id,
      email: user.Email,
      role: roleName,
      roleId: user.UserRole,
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
          id: user.Id,
          first_name: user.FirstName,
          last_name: user.LastName,
          email: user.Email,
          role: roleName,
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
