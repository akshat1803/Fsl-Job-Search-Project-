const express = require('express');
const router = express.Router();
const pool = require('../db');
const { authenticateToken } = require('../middleware/auth');

// GET /api/candidates/:id - Get candidate profile with all details
router.get('/:id', authenticateToken, async (req, res) => {
  const candidateId = parseInt(req.params.id);

  try {
    // 1. Get candidate basic & user details
    const [candidates] = await pool.query(
      `SELECT c.*, u.first_name, u.last_name, u.email, u.mobile_no, u.avatar_url, u.bio, u.role
       FROM candidates c
       JOIN users u ON c.user_id = u.id
       WHERE c.id = ?`,
      [candidateId]
    );

    if (candidates.length === 0) {
      return res.status(404).json({ success: false, message: 'Candidate not found' });
    }

    const profile = candidates[0];

    // Check visibility / ownership
    // If not public, only candidate owner or a company can view it
    if (profile.visibility !== 'public' && req.user.role !== 'company' && req.user.candidateId !== candidateId) {
      return res.status(403).json({ success: false, message: 'Private profile access denied' });
    }

    // 2. Get educations
    const [educations] = await pool.query('SELECT * FROM educations WHERE candidate_id = ? ORDER BY start_date DESC', [candidateId]);

    // 3. Get experiences
    const [experiences] = await pool.query('SELECT * FROM experiences WHERE candidate_id = ? ORDER BY start_date DESC', [candidateId]);

    // 4. Get certifications
    const [certifications] = await pool.query('SELECT * FROM certifications WHERE candidate_id = ? ORDER BY issued_on DESC', [candidateId]);

    // 5. Get training courses
    const [trainingCourses] = await pool.query('SELECT * FROM training_courses WHERE candidate_id = ? ORDER BY start_date DESC', [candidateId]);

    // 6. Get languages
    const [languages] = await pool.query('SELECT * FROM candidate_languages WHERE candidate_id = ?', [candidateId]);

    // 7. Get driving licenses
    const [drivingLicenses] = await pool.query('SELECT * FROM driving_licenses WHERE candidate_id = ?', [candidateId]);

    // 8. Get desired jobs
    const [desiredJobs] = await pool.query('SELECT * FROM desired_jobs WHERE candidate_id = ?', [candidateId]);

    // 9. Get skills
    const [skills] = await pool.query(
      `SELECT s.id, s.name 
       FROM candidate_skills cs
       JOIN skills s ON cs.skill_id = s.id
       WHERE cs.candidate_id = ?`,
      [candidateId]
    );

    // Assemble profile data
    const profileData = {
      ...profile,
      educations,
      experiences,
      certifications,
      training_courses: trainingCourses,
      languages,
      driving_licenses: drivingLicenses,
      desired_jobs: desiredJobs,
      skills
    };

    // Remove sensitive fields
    delete profileData.password_hash;

    return res.json({ success: true, data: profileData });
  } catch (error) {
    console.error('Get Candidate Error:', error);
    return res.status(500).json({ success: false, message: 'Server error retrieving candidate profile' });
  }
});

// PUT /api/candidates/:id - Update candidate profile
router.put('/:id', authenticateToken, async (req, res) => {
  const candidateId = parseInt(req.params.id);

  // Authorization check
  if (req.user.role !== 'candidate' || req.user.candidateId !== candidateId) {
    return res.status(403).json({ success: false, message: 'Unauthorized to update this profile' });
  }

  const {
    first_name, last_name, mobile_no, avatar_url, bio,
    dob, visibility, street, building_apartment, town_city, state_province, country_code,
    video_url, video_thumbnail_url, video_duration_seconds, video_status
  } = req.body;

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // 1. Get user_id of the candidate
    const [candidates] = await connection.query('SELECT user_id FROM candidates WHERE id = ?', [candidateId]);
    if (candidates.length === 0) {
      await connection.rollback();
      return res.status(404).json({ success: false, message: 'Candidate record not found' });
    }
    const userId = candidates[0].user_id;

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

    // 3. Update candidates table
    await connection.query(
      `UPDATE candidates
       SET dob = COALESCE(?, dob),
           visibility = COALESCE(?, visibility),
           street = COALESCE(?, street),
           building_apartment = COALESCE(?, building_apartment),
           town_city = COALESCE(?, town_city),
           state_province = COALESCE(?, state_province),
           country_code = COALESCE(?, country_code),
           video_url = COALESCE(?, video_url),
           video_thumbnail_url = COALESCE(?, video_thumbnail_url),
           video_duration_seconds = COALESCE(?, video_duration_seconds),
           video_status = COALESCE(?, video_status)
       WHERE id = ?`,
      [
        dob, visibility, street, building_apartment, town_city, state_province, country_code,
        video_url, video_thumbnail_url, video_duration_seconds, video_status, candidateId
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

// POST /api/candidates/:id/education - Add education
router.post('/:id/education', authenticateToken, async (req, res) => {
  const candidateId = parseInt(req.params.id);

  if (req.user.role !== 'candidate' || req.user.candidateId !== candidateId) {
    return res.status(403).json({ success: false, message: 'Unauthorized to add education to this profile' });
  }

  const { degree_type, institution, specialization, town_city, state, country_code, start_date, end_date, currently_studying } = req.body;

  if (!degree_type || !institution) {
    return res.status(400).json({ success: false, message: 'Degree type and institution are required' });
  }

  try {
    const [result] = await pool.query(
      `INSERT INTO educations (candidate_id, degree_type, institution, specialization, town_city, state, country_code, start_date, end_date, currently_studying)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [candidateId, degree_type, institution, specialization || null, town_city || null, state || null, country_code || null, start_date || null, end_date || null, currently_studying ? 1 : 0]
    );

    return res.status(201).json({
      success: true,
      message: 'Education added successfully',
      data: {
        id: result.insertId,
        candidate_id: candidateId,
        degree_type,
        institution
      }
    });
  } catch (error) {
    console.error('Add Education Error:', error);
    return res.status(500).json({ success: false, message: 'Server error adding education' });
  }
});

// POST /api/candidates/:id/experience - Add experience
router.post('/:id/experience', authenticateToken, async (req, res) => {
  const candidateId = parseInt(req.params.id);

  if (req.user.role !== 'candidate' || req.user.candidateId !== candidateId) {
    return res.status(403).json({ success: false, message: 'Unauthorized to add experience to this profile' });
  }

  const { job_title, company, industry, employment_type, country_code, start_date, end_date, currently_working, description } = req.body;

  if (!job_title || !company) {
    return res.status(400).json({ success: false, message: 'Job title and company are required' });
  }

  try {
    const [result] = await pool.query(
      `INSERT INTO experiences (candidate_id, job_title, company, industry, employment_type, country_code, start_date, end_date, currently_working, description)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [candidateId, job_title, company, industry || null, employment_type || null, country_code || null, start_date || null, end_date || null, currently_working ? 1 : 0, description || null]
    );

    return res.status(201).json({
      success: true,
      message: 'Experience added successfully',
      data: {
        id: result.insertId,
        candidate_id: candidateId,
        job_title,
        company
      }
    });
  } catch (error) {
    console.error('Add Experience Error:', error);
    return res.status(500).json({ success: false, message: 'Server error adding experience' });
  }
});

// POST /api/candidates/:id/skills - Add skills
router.post('/:id/skills', authenticateToken, async (req, res) => {
  const candidateId = parseInt(req.params.id);

  if (req.user.role !== 'candidate' || req.user.candidateId !== candidateId) {
    return res.status(403).json({ success: false, message: 'Unauthorized to add skills to this profile' });
  }

  const { skill_name } = req.body;

  if (!skill_name || typeof skill_name !== 'string' || skill_name.trim() === '') {
    return res.status(400).json({ success: false, message: 'Skill name is required' });
  }

  const normalizedSkill = skill_name.trim();

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // 1. Get or create the skill in skills table
    let skillId;
    const [skills] = await connection.query('SELECT id FROM skills WHERE LOWER(name) = LOWER(?)', [normalizedSkill]);
    
    if (skills.length > 0) {
      skillId = skills[0].id;
    } else {
      const [insertResult] = await connection.query('INSERT INTO skills (name) VALUES (?)', [normalizedSkill]);
      skillId = insertResult.insertId;
    }

    // 2. Link candidate and skill if not already linked
    const [links] = await connection.query(
      'SELECT id FROM candidate_skills WHERE candidate_id = ? AND skill_id = ?',
      [candidateId, skillId]
    );

    if (links.length === 0) {
      await connection.query(
        'INSERT INTO candidate_skills (candidate_id, skill_id) VALUES (?, ?)',
        [candidateId, skillId]
      );
    }

    await connection.commit();

    return res.status(201).json({
      success: true,
      message: 'Skill added to profile successfully',
      data: {
        skill_id: skillId,
        skill_name: normalizedSkill
      }
    });
  } catch (error) {
    await connection.rollback();
    console.error('Add Skill Error:', error);
    return res.status(500).json({ success: false, message: 'Server error adding skill' });
  } finally {
    connection.release();
  }
});

// GET /api/candidates/:id/applications - Get candidate's applications
router.get('/:id/applications', authenticateToken, async (req, res) => {
  const candidateId = parseInt(req.params.id);

  if (req.user.role !== 'candidate' || req.user.candidateId !== candidateId) {
    return res.status(403).json({ success: false, message: 'Unauthorized to view these applications' });
  }

  try {
    const [applications] = await pool.query(
      `SELECT a.*, jv.title as job_title, jv.employment_type, jv.salary, jv.currency, jv.workplace_type, c.name as company_name, c.logo_url
       FROM applications a
       JOIN job_vacancies jv ON a.vacancy_id = jv.id
       JOIN companies c ON jv.company_id = c.id
       WHERE a.candidate_id = ?
       ORDER BY a.applied_at DESC`,
      [candidateId]
    );

    return res.json({ success: true, data: applications });
  } catch (error) {
    console.error('Get Applications Error:', error);
    return res.status(500).json({ success: false, message: 'Server error retrieving applications' });
  }
});

module.exports = router;
