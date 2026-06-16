const express = require('express');
const router = express.Router();
const pool = require('../db');
const { authenticateToken } = require('../middleware/auth');

// GET /api/companies/:id - Get company profile
router.get('/:id', authenticateToken, async (req, res) => {
  const companyId = req.params.id ? req.params.id.trim() : ''; // UUID string

  try {
    const [companies] = await pool.query(
      `SELECT c.*, u.FirstName, u.LastName, u.Email, u.MobileNo, u.Bio
       FROM Companies c
       JOIN Users u ON c.UserId = u.Id
       WHERE c.Id = ? AND c.IsActive = TRUE`,
      [companyId]
    );

    if (companies.length === 0) {
      return res.status(404).json({ success: false, message: 'Company not found' });
    }

    const profile = companies[0];

    // Format response to be consistent
    const responseData = {
      id: profile.Id,
      userId: profile.UserId,
      firstName: profile.FirstName,
      lastName: profile.LastName,
      email: profile.Email,
      mobileNo: profile.MobileNo,
      bio: profile.Bio,
      name: profile.Name,
      taxId: profile.TaxId,
      vatNo: profile.VatNo,
      industryId: profile.IndustryId,
      size: profile.Size,
      website: profile.Website,
      logo: profile.Logo,
      description: profile.Description,
      contactPerson: profile.ContactPerson,
      createdAt: profile.CreatedAt
    };

    return res.json({ success: true, data: responseData });
  } catch (error) {
    console.error('Get Company Error:', error);
    return res.status(500).json({ success: false, message: 'Server error retrieving company profile' });
  }
});

// PUT /api/companies/:id - Update company profile
router.put('/:id', authenticateToken, async (req, res) => {
  const companyId = req.params.id ? req.params.id.trim() : '';

  // Authorization check
  if (req.user.role !== 'company' || !req.user.companyId || req.user.companyId.toLowerCase() !== companyId.toLowerCase()) {
    return res.status(403).json({ success: false, message: 'Unauthorized to update this company profile' });
  }

  const {
    firstName, lastName, mobileNo, bio,
    name, taxId, vatNo, industryId, size, website, logo, description, contactPerson
  } = req.body;

  const companyName = name || req.body.CompanyName;
  if (companyName && companyName.trim() === '') {
    return res.status(400).json({ success: false, message: 'Company name cannot be empty' });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // 1. Get UserId for this Company
    const [companies] = await connection.query('SELECT UserId FROM Companies WHERE Id = ?', [companyId]);
    if (companies.length === 0) {
      await connection.rollback();
      return res.status(404).json({ success: false, message: 'Company record not found' });
    }
    const userId = companies[0].UserId;

    // 2. Update Users table
    await connection.query(
      `UPDATE Users 
       SET FirstName = COALESCE(?, FirstName),
           LastName = COALESCE(?, LastName),
           MobileNo = COALESCE(?, MobileNo),
           Bio = COALESCE(?, Bio)
       WHERE Id = ?`,
      [
        firstName || req.body.first_name || null,
        lastName || req.body.last_name || null,
        mobileNo || req.body.mobile_no || null,
        bio || null,
        userId
      ]
    );

    // 3. Update Companies table
    await connection.query(
      `UPDATE Companies
       SET Name = COALESCE(?, Name),
           TaxId = COALESCE(?, TaxId),
           VatNo = COALESCE(?, VatNo),
           IndustryId = COALESCE(?, IndustryId),
           Size = COALESCE(?, Size),
           Website = COALESCE(?, Website),
           Logo = COALESCE(?, Logo),
           Description = COALESCE(?, Description),
           ContactPerson = COALESCE(?, ContactPerson),
           UpdatedAt = CURRENT_TIMESTAMP
       WHERE Id = ?`,
      [
        companyName || null,
        taxId || req.body.tax_id || null,
        vatNo || req.body.vat_no || null,
        industryId || req.body.industry_id || null,
        size || null,
        website || null,
        logo || req.body.logo_url || null,
        description || null,
        contactPerson || req.body.contact_person || null,
        companyId
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
