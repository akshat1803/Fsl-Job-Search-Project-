const express = require('express');
const router = express.Router();
const pool = require('../db');
const { authenticateToken } = require('../middleware/auth');

// GET /api/candidates/:id - Get candidate profile with all details
router.get('/:id', authenticateToken, async (req, res) => {
  const candidateId = req.params.id ? req.params.id.trim() : ''; // UUID string

  try {
    // 1. Get candidate basic & user details from Candidate & Users
    const [candidates] = await pool.query(
      `SELECT c.*, u.FirstName, u.LastName, u.Email, u.MobileNo, u.Bio
       FROM Candidate c
       JOIN Users u ON c.UserId = u.Id
       WHERE c.Id = ? AND c.IsActive = TRUE`,
      [candidateId]
    );

    if (candidates.length === 0) {
      return res.status(404).json({ success: false, message: 'Candidate not found' });
    }

    const profile = candidates[0];

    const parseJSON = (field) => {
      if (!field) return [];
      if (typeof field === 'object') return field;
      try {
        return JSON.parse(field);
      } catch (e) {
        return [];
      }
    };

    const parseJSONObj = (field) => {
      if (!field) return {};
      if (typeof field === 'object') return field;
      try {
        return JSON.parse(field);
      } catch (e) {
        return {};
      }
    };

    // Assemble profile data mapping the JSON columns
    const profileData = {
      id: profile.Id,
      userId: profile.UserId,
      firstName: profile.FirstName,
      lastName: profile.LastName,
      email: profile.Email,
      mobileNo: profile.MobileNo,
      bio: profile.Bio,
      dob: profile.DOB,
      visibility: profile.Visibility,
      address: parseJSONObj(profile.Address),
      skills: parseJSON(profile.Skills),
      languages: parseJSON(profile.Languages),
      education: parseJSON(profile.Education),
      experience: parseJSON(profile.Experience),
      certifications: parseJSON(profile.Certifications),
      trainingCourses: parseJSON(profile.TrainingCourses),
      drivingLicenses: parseJSON(profile.DrivingLicenses),
      desiredJob: parseJSONObj(profile.DesiredJob),
      createdAt: profile.CreatedAt,
      isActive: profile.IsActive
    };

    return res.json({ success: true, data: profileData });
  } catch (error) {
    console.error('Get Candidate Error:', error);
    return res.status(500).json({ success: false, message: 'Server error retrieving candidate profile' });
  }
});

// PUT /api/candidates/:id - Update candidate profile (consolidated endpoint)
router.put('/:id', authenticateToken, async (req, res) => {
  const candidateId = req.params.id ? req.params.id.trim() : ''; // UUID string

  // Authorization check: User can only update their own candidate profile
  if (req.user.role !== 'candidate' || !req.user.candidateId || req.user.candidateId.toLowerCase() !== candidateId.toLowerCase()) {
    return res.status(403).json({ success: false, message: 'Unauthorized to update this profile' });
  }

  const {
    firstName, lastName, mobileNo, bio,
    dob, visibility, address, skills, languages, education, experience, certifications, trainingCourses, drivingLicenses, desiredJob
  } = req.body;

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // 1. Get UserId for this Candidate
    const [candidates] = await connection.query('SELECT UserId FROM Candidate WHERE Id = ?', [candidateId]);
    if (candidates.length === 0) {
      await connection.rollback();
      return res.status(404).json({ success: false, message: 'Candidate record not found' });
    }
    const userId = candidates[0].UserId;

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

    // Helper to stringify JSON parameters safely
    const jsonParam = (val) => {
      if (val === undefined) return null;
      return typeof val === 'object' ? JSON.stringify(val) : val;
    };

    // 3. Update Candidate table
    await connection.query(
      `UPDATE Candidate
       SET DOB = COALESCE(?, DOB),
           Visibility = COALESCE(?, Visibility),
           Address = COALESCE(?, Address),
           Skills = COALESCE(?, Skills),
           Languages = COALESCE(?, Languages),
           Education = COALESCE(?, Education),
           Experience = COALESCE(?, Experience),
           Certifications = COALESCE(?, Certifications),
           TrainingCourses = COALESCE(?, TrainingCourses),
           DrivingLicenses = COALESCE(?, DrivingLicenses),
           DesiredJob = COALESCE(?, DesiredJob),
           UpdatedAt = CURRENT_TIMESTAMP
       WHERE Id = ?`,
      [
        dob || null,
        visibility || null,
        jsonParam(address || req.body.Address),
        jsonParam(skills || req.body.Skills),
        jsonParam(languages || req.body.Languages),
        jsonParam(education || req.body.Education),
        jsonParam(experience || req.body.Experience),
        jsonParam(certifications || req.body.Certifications),
        jsonParam(trainingCourses || req.body.TrainingCourses),
        jsonParam(drivingLicenses || req.body.DrivingLicenses),
        jsonParam(desiredJob || req.body.DesiredJob),
        candidateId
      ]
    );

    await connection.commit();
    return res.json({ success: true, message: 'Profile updated successfully' });
  } catch (error) {
    await connection.rollback();
    console.error('Update Candidate Error:', error);
    return res.status(500).json({ success: false, message: 'Server error updating profile' });
  } finally {
    connection.release();
  }
});

// GET /api/candidates/:id/applications - Get candidate's applications
router.get('/:id/applications', authenticateToken, async (req, res) => {
  const candidateId = req.params.id ? req.params.id.trim() : '';

  if (req.user.role !== 'candidate' || !req.user.candidateId || req.user.candidateId.toLowerCase() !== candidateId.toLowerCase()) {
    return res.status(403).json({ success: false, message: 'Unauthorized to view these applications' });
  }

  try {
    const [applications] = await pool.query(
      `SELECT a.*, jv.Title as job_title, jv.EmploymentTypeId as employment_type, jv.Salary as salary, jv.Currency as currency, jv.WorkplaceTypeId as workplace_type, c.Name as company_name, c.Logo as logo_url
       FROM Applications a
       JOIN JobVacancies jv ON a.VacancyId = jv.Id
       JOIN Companies c ON jv.CompanyId = c.Id
       WHERE a.CandidateId = ? AND a.IsActive = TRUE
       ORDER BY a.CreatedAt DESC`,
      [candidateId]
    );

    return res.json({ success: true, data: applications });
  } catch (error) {
    console.error('Get Applications Error:', error);
    return res.status(500).json({ success: false, message: 'Server error retrieving applications' });
  }
});

module.exports = router;
