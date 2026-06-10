const express = require('express');
const router = express.Router();
const pool = require('../db');
const { authenticateToken } = require('../middleware/auth');

// GET /api/companies/:id - Get company profile
router.get('/:id', authenticateToken, async (req, res) => {
  const companyId = parseInt(req.params.id);

  try {
    const [companies] = await pool.query(
      `SELECT c.*, u.first_name, u.last_name, u.email, u.mobile_no, u.avatar_url, u.bio, u.role
       FROM companies c
       JOIN users u ON c.user_id = u.id
       WHERE c.id = ?`,
      [companyId]
    );

    if (companies.length === 0) {
      return res.status(404).json({ success: false, message: 'Company not found' });
    }

    const profile = companies[0];
    delete profile.password_hash;

    return res.json({ success: true, data: profile });
  } catch (error) {
    console.error('Get Company Error:', error);
    return res.status(500).json({ success: false, message: 'Server error retrieving company profile' });
  }
});

// PUT /api/companies/:id - Update company profile
router.put('/:id', authenticateToken, async (req, res) => {
  const companyId = parseInt(req.params.id);

  // Authorization check
  if (req.user.role !== 'company' || req.user.companyId !== companyId) {
    return res.status(403).json({ success: false, message: 'Unauthorized to update this company profile' });
  }

  const {
    first_name, last_name, mobile_no, avatar_url, bio,
    name, tax_id, vat_no, industry, size, website, logo_url, description, contact_person
  } = req.body;

  if (name && name.trim() === '') {
    return res.status(400).json({ success: false, message: 'Company name cannot be empty' });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // 1. Get user_id for this company
    const [companies] = await connection.query('SELECT user_id FROM companies WHERE id = ?', [companyId]);
    if (companies.length === 0) {
      await connection.rollback();
      return res.status(404).json({ success: false, message: 'Company record not found' });
    }
    const userId = companies[0].user_id;

    // 2. Update users table
    await connection.query(
      `UPDATE users 
       SET first_name = COALESCE(?, first_name),
           last_name = COALESCE(?, last_name),
           mobile_no = COALESCE(?, mobile_no),
           avatar_url = COALESCE(?, avatar_url),
           bio = COALESCE(?, bio)
       WHERE id = ?`,
      [first_name, last_name, mobile_no, avatar_url, bio, userId]
    );

    // 3. Update companies table
    await connection.query(
      `UPDATE companies
       SET name = COALESCE(?, name),
           tax_id = COALESCE(?, tax_id),
           vat_no = COALESCE(?, vat_no),
           industry = COALESCE(?, industry),
           size = COALESCE(?, size),
           website = COALESCE(?, website),
           logo_url = COALESCE(?, logo_url),
           description = COALESCE(?, description),
           contact_person = COALESCE(?, contact_person)
       WHERE id = ?`,
      [
        name, tax_id, vat_no, industry, size, website, logo_url, description, contact_person, companyId
      ]
    );

    await connection.commit();
    return res.json({ success: true, message: 'Company profile updated successfully' });
  } catch (error) {
    await connection.rollback();
    console.error('Update Company Error:', error);
    return res.status(500).json({ success: false, message: 'Server error updating company profile' });
  } finally {
    connection.release();
  }
});

module.exports = router;
