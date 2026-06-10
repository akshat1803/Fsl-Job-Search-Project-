const express = require('express');
const router = express.Router();
const pool = require('../db');
const { authenticateToken, requireRole } = require('../middleware/auth');

// GET /api/jobs - Get all active jobs (with filters)
router.get('/', async (req, res) => {
  const { search, country, workplace_type, employment_type } = req.query;

  try {
    let query = `
      SELECT jv.*, c.name as company_name, c.logo_url as company_logo, c.industry as company_industry,
             GROUP_CONCAT(s.name) as skills
      FROM job_vacancies jv
      JOIN companies c ON jv.company_id = c.id
      LEFT JOIN vacancy_skills vs ON jv.id = vs.vacancy_id
      LEFT JOIN skills s ON vs.skill_id = s.id
      WHERE jv.status = 'active'
    `;
    const params = [];

    if (search) {
      query += ` AND (jv.title LIKE ? OR jv.description LIKE ?)`;
      params.push(`%${search}%`, `%${search}%`);
    }

    if (country) {
      query += ` AND jv.country_code = ?`;
      params.push(country);
    }

    if (workplace_type) {
      query += ` AND jv.workplace_type = ?`;
      params.push(workplace_type);
    }

    if (employment_type) {
      query += ` AND jv.employment_type = ?`;
      params.push(employment_type);
    }

    query += ` GROUP BY jv.id ORDER BY jv.created_at DESC`;

    const [jobs] = await pool.query(query, params);

    // Map concatenated skills back to an array
    const formattedJobs = jobs.map(job => ({
      ...job,
      skills: job.skills ? job.skills.split(',') : []
    }));

    return res.json({ success: true, data: formattedJobs });
  } catch (error) {
    console.error('Get Jobs Error:', error);
    return res.status(500).json({ success: false, message: 'Server error retrieving jobs' });
  }
});

// GET /api/jobs/:id - Get single job detail
router.get('/:id', async (req, res) => {
  const jobId = parseInt(req.params.id);

  try {
    const [jobs] = await pool.query(
      `SELECT jv.*, c.name as company_name, c.logo_url as company_logo, c.industry as company_industry, c.description as company_description
       FROM job_vacancies jv
       JOIN companies c ON jv.company_id = c.id
       WHERE jv.id = ?`,
      [jobId]
    );

    if (jobs.length === 0) {
      return res.status(404).json({ success: false, message: 'Job vacancy not found' });
    }

    const job = jobs[0];

    // Fetch skills
    const [skills] = await pool.query(
      `SELECT s.id, s.name
       FROM vacancy_skills vs
       JOIN skills s ON vs.skill_id = s.id
       WHERE vs.vacancy_id = ?`,
      [jobId]
    );

    job.skills = skills;

    return res.json({ success: true, data: job });
  } catch (error) {
    console.error('Get Job Detail Error:', error);
    return res.status(500).json({ success: false, message: 'Server error retrieving job detail' });
  }
});

// POST /api/jobs - Create job vacancy (company only)
router.post('/', authenticateToken, requireRole('company'), async (req, res) => {
  const companyId = req.user.companyId;

  if (!companyId) {
    return res.status(403).json({ success: false, message: 'Unauthorized. Company profile required.' });
  }

  const { title, description, employment_type, salary, currency, country_code, workplace_type, deadline, skills } = req.body;

  if (!title || !employment_type || !workplace_type) {
    return res.status(400).json({ success: false, message: 'Title, employment type, and workplace type are required' });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // Insert job vacancy
    const [jobResult] = await connection.query(
      `INSERT INTO job_vacancies (company_id, title, description, employment_type, salary, currency, country_code, workplace_type, deadline, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
      [companyId, title, description || null, employment_type, salary || null, currency || null, country_code || null, workplace_type, deadline || null]
    );

    const jobId = jobResult.insertId;

    // Insert skills if provided
    if (skills && Array.isArray(skills)) {
      for (const skillName of skills) {
        if (typeof skillName !== 'string' || skillName.trim() === '') continue;
        const normalizedSkill = skillName.trim();

        // 1. Get or create skill
        let skillId;
        const [existingSkills] = await connection.query('SELECT id FROM skills WHERE LOWER(name) = LOWER(?)', [normalizedSkill]);
        if (existingSkills.length > 0) {
          skillId = existingSkills[0].id;
        } else {
          const [insertSkillResult] = await connection.query('INSERT INTO skills (name) VALUES (?)', [normalizedSkill]);
          skillId = insertSkillResult.insertId;
        }

        // 2. Link skill to vacancy
        await connection.query(
          'INSERT INTO vacancy_skills (vacancy_id, skill_id) VALUES (?, ?)',
          [jobId, skillId]
        );
      }
    }

    await connection.commit();

    return res.status(201).json({
      success: true,
      message: 'Job vacancy created successfully',
      data: {
        id: jobId,
        company_id: companyId,
        title,
        employment_type,
        workplace_type
      }
    });
  } catch (error) {
    await connection.rollback();
    console.error('Create Job Error:', error);
    return res.status(500).json({ success: false, message: 'Server error creating job vacancy' });
  } finally {
    connection.release();
  }
});

// PUT /api/jobs/:id - Update job vacancy (company owner only)
router.put('/:id', authenticateToken, requireRole('company'), async (req, res) => {
  const jobId = parseInt(req.params.id);
  const companyId = req.user.companyId;

  if (!companyId) {
    return res.status(403).json({ success: false, message: 'Unauthorized. Company profile required.' });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // Verify vacancy ownership
    const [jobs] = await connection.query('SELECT company_id FROM job_vacancies WHERE id = ?', [jobId]);
    if (jobs.length === 0) {
      await connection.rollback();
      return res.status(404).json({ success: false, message: 'Job vacancy not found' });
    }

    if (jobs[0].company_id !== companyId) {
      await connection.rollback();
      return res.status(403).json({ success: false, message: 'Unauthorized. You do not own this job vacancy.' });
    }

    const { title, description, employment_type, salary, currency, country_code, workplace_type, status, deadline, skills } = req.body;

    // Update job vacancy
    await connection.query(
      `UPDATE job_vacancies
       SET title = COALESCE(?, title),
           description = COALESCE(?, description),
           employment_type = COALESCE(?, employment_type),
           salary = COALESCE(?, salary),
           currency = COALESCE(?, currency),
           country_code = COALESCE(?, country_code),
           workplace_type = COALESCE(?, workplace_type),
           status = COALESCE(?, status),
           deadline = COALESCE(?, deadline)
       WHERE id = ?`,
      [title, description, employment_type, salary, currency, country_code, workplace_type, status, deadline, jobId]
    );

    // Update skills if provided
    if (skills && Array.isArray(skills)) {
      // Clear existing skill links
      await connection.query('DELETE FROM vacancy_skills WHERE vacancy_id = ?', [jobId]);

      for (const skillName of skills) {
        if (typeof skillName !== 'string' || skillName.trim() === '') continue;
        const normalizedSkill = skillName.trim();

        // Get or create skill
        let skillId;
        const [existingSkills] = await connection.query('SELECT id FROM skills WHERE LOWER(name) = LOWER(?)', [normalizedSkill]);
        if (existingSkills.length > 0) {
          skillId = existingSkills[0].id;
        } else {
          const [insertSkillResult] = await connection.query('INSERT INTO skills (name) VALUES (?)', [normalizedSkill]);
          skillId = insertSkillResult.insertId;
        }

        // Link skill to vacancy
        await connection.query(
          'INSERT INTO vacancy_skills (vacancy_id, skill_id) VALUES (?, ?)',
          [jobId, skillId]
        );
      }
    }

    await connection.commit();
    return res.json({ success: true, message: 'Job vacancy updated successfully' });
  } catch (error) {
    await connection.rollback();
    console.error('Update Job Error:', error);
    return res.status(500).json({ success: false, message: 'Server error updating job vacancy' });
  } finally {
    connection.release();
  }
});

// DELETE /api/jobs/:id - Delete job vacancy (company owner only)
router.delete('/:id', authenticateToken, requireRole('company'), async (req, res) => {
  const jobId = parseInt(req.params.id);
  const companyId = req.user.companyId;

  if (!companyId) {
    return res.status(403).json({ success: false, message: 'Unauthorized. Company profile required.' });
  }

  try {
    // Verify vacancy ownership
    const [jobs] = await pool.query('SELECT company_id FROM job_vacancies WHERE id = ?', [jobId]);
    if (jobs.length === 0) {
      return res.status(404).json({ success: false, message: 'Job vacancy not found' });
    }

    if (jobs[0].company_id !== companyId) {
      return res.status(403).json({ success: false, message: 'Unauthorized. You do not own this job vacancy.' });
    }

    // Delete job vacancy (Cascades to vacancy_skills, applications)
    await pool.query('DELETE FROM job_vacancies WHERE id = ?', [jobId]);

    return res.json({ success: true, message: 'Job vacancy deleted successfully' });
  } catch (error) {
    console.error('Delete Job Error:', error);
    return res.status(500).json({ success: false, message: 'Server error deleting job vacancy' });
  }
});

module.exports = router;
