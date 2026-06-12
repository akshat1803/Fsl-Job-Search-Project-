const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const pool = require('../db');
const { authenticateToken, optionalAuthenticateToken, requireRole } = require('../middleware/auth');

// GET /api/jobs - Get all active jobs (with filters)
router.get('/', optionalAuthenticateToken, async (req, res) => {
  const { search, countryId, workplaceTypeId, employmentTypeId } = req.query;

  try {
    let query = `
      SELECT jv.*, c.Name as company_name, c.Logo as company_logo, c.Description as company_description
      FROM JobVacancies jv
      JOIN Companies c ON jv.CompanyId = c.Id
      WHERE jv.Status = 'open' AND jv.IsActive = TRUE
    `;
    const params = [];

    if (search) {
      query += ` AND (jv.Title LIKE ? OR jv.Description LIKE ?)`;
      params.push(`%${search}%`, `%${search}%`);
    }

    if (countryId) {
      query += ` AND jv.CountryId = ?`;
      params.push(parseInt(countryId));
    }

    if (workplaceTypeId) {
      query += ` AND jv.WorkplaceTypeId = ?`;
      params.push(parseInt(workplaceTypeId));
    }

    if (employmentTypeId) {
      query += ` AND jv.EmploymentTypeId = ?`;
      params.push(parseInt(employmentTypeId));
    }

    query += ` ORDER BY jv.CreatedAt DESC`;

    const [jobs] = await pool.query(query, params);

    // Fetch applied job vacancies if requester is a candidate
    let appliedVacancyIds = new Set();
    if (req.user && req.user.role === 'candidate' && req.user.candidateId) {
      const [apps] = await pool.query('SELECT VacancyId FROM Applications WHERE CandidateId = ? AND IsActive = TRUE', [req.user.candidateId]);
      appliedVacancyIds = new Set(apps.map(a => a.VacancyId));
    }

    // Map response
    const formattedJobs = jobs.map(job => {
      const isOwner = req.user && req.user.role === 'company' && req.user.companyId === job.CompanyId;
      const hasApplied = req.user && req.user.role === 'candidate' && appliedVacancyIds.has(job.Id);
      const showDetails = isOwner || hasApplied;

      let skills = [];
      if (job.RequiredSkills) {
        skills = typeof job.RequiredSkills === 'string' ? JSON.parse(job.RequiredSkills) : job.RequiredSkills;
      }

      return {
        id: job.Id,
        companyId: job.CompanyId,
        userId: job.UserId,
        title: job.Title,
        description: job.Description,
        employmentTypeId: job.EmploymentTypeId,
        salary: job.Salary,
        currency: job.Currency,
        countryId: job.CountryId,
        workplaceTypeId: job.WorkplaceTypeId,
        requiredSkills: skills,
        status: job.Status,
        deadline: job.Deadline,
        createdAt: job.CreatedAt,
        companyName: showDetails ? job.company_name : 'Hidden',
        companyLogo: showDetails ? job.company_logo : null,
        companyDescription: showDetails ? job.company_description : null
      };
    });

    return res.json({ success: true, data: formattedJobs });
  } catch (error) {
    console.error('Get Jobs Error:', error);
    return res.status(500).json({ success: false, message: 'Server error retrieving jobs' });
  }
});

// GET /api/jobs/:id - Get single job detail
router.get('/:id', optionalAuthenticateToken, async (req, res) => {
  const jobId = req.params.id ? req.params.id.trim() : ''; // UUID string

  try {
    const [jobs] = await pool.query(
      `SELECT jv.*, c.Name as company_name, c.Logo as company_logo, c.Description as company_description
       FROM JobVacancies jv
       JOIN Companies c ON jv.CompanyId = c.Id
       WHERE jv.Id = ? AND jv.IsActive = TRUE`,
      [jobId]
    );

    if (jobs.length === 0) {
      return res.status(404).json({ success: false, message: 'Job vacancy not found' });
    }

    const job = jobs[0];

    // Determine if company details should be shown
    let showDetails = false;
    if (req.user) {
      if (req.user.role === 'company' && req.user.companyId === job.CompanyId) {
        showDetails = true;
      } else if (req.user.role === 'candidate' && req.user.candidateId) {
        const [apps] = await pool.query(
          'SELECT Id FROM Applications WHERE CandidateId = ? AND VacancyId = ? AND IsActive = TRUE',
          [req.user.candidateId, jobId]
        );
        if (apps.length > 0) {
          showDetails = true;
        }
      }
    }

    let skills = [];
    if (job.RequiredSkills) {
      skills = typeof job.RequiredSkills === 'string' ? JSON.parse(job.RequiredSkills) : job.RequiredSkills;
    }

    const jobData = {
      id: job.Id,
      companyId: job.CompanyId,
      userId: job.UserId,
      title: job.Title,
      description: job.Description,
      employmentTypeId: job.EmploymentTypeId,
      salary: job.Salary,
      currency: job.Currency,
      countryId: job.CountryId,
      workplaceTypeId: job.WorkplaceTypeId,
      requiredSkills: skills,
      status: job.Status,
      deadline: job.Deadline,
      createdAt: job.CreatedAt,
      companyName: showDetails ? job.company_name : 'Hidden',
      companyLogo: showDetails ? job.company_logo : null,
      companyDescription: showDetails ? job.company_description : null
    };

    return res.json({ success: true, data: jobData });
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

  const { title, description, employmentTypeId, salary, currency, countryId, workplaceTypeId, deadline, requiredSkills } = req.body;

  if (!title || !employmentTypeId || !workplaceTypeId) {
    return res.status(400).json({ success: false, message: 'Title, employmentTypeId, and workplaceTypeId are required' });
  }

  try {
    const jobId = crypto.randomUUID();
    const skillsJSON = requiredSkills ? JSON.stringify(requiredSkills) : '[]';

    await pool.query(
      `INSERT INTO JobVacancies (Id, CompanyId, UserId, Title, Description, EmploymentTypeId, Salary, Currency, CountryId, WorkplaceTypeId, RequiredSkills, Status, Deadline, IsActive)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, TRUE)`,
      [
        jobId,
        companyId,
        req.user.id,
        title,
        description || null,
        parseInt(employmentTypeId),
        salary || null,
        currency || null,
        countryId ? parseInt(countryId) : null,
        parseInt(workplaceTypeId),
        skillsJSON,
        deadline || null
      ]
    );

    return res.status(201).json({
      success: true,
      message: 'Job vacancy created successfully',
      data: {
        id: jobId,
        companyId,
        title,
        employmentTypeId,
        workplaceTypeId
      }
    });
  } catch (error) {
    console.error('Create Job Error:', error);
    return res.status(500).json({ success: false, message: 'Server error creating job vacancy' });
  }
});

// PUT /api/jobs/:id - Update job vacancy (company owner only)
router.put('/:id', authenticateToken, requireRole('company'), async (req, res) => {
  const jobId = req.params.id ? req.params.id.trim() : ''; // UUID string
  const companyId = req.user.companyId;

  if (!companyId) {
    return res.status(403).json({ success: false, message: 'Unauthorized. Company profile required.' });
  }

  try {
    // Verify vacancy ownership
    const [jobs] = await pool.query('SELECT CompanyId FROM JobVacancies WHERE Id = ?', [jobId]);
    if (jobs.length === 0) {
      return res.status(404).json({ success: false, message: 'Job vacancy not found' });
    }

    if (jobs[0].CompanyId !== companyId) {
      return res.status(403).json({ success: false, message: 'Unauthorized. You do not own this job vacancy.' });
    }

    const { title, description, employmentTypeId, salary, currency, countryId, workplaceTypeId, status, deadline, requiredSkills } = req.body;

    const skillsJSON = requiredSkills ? JSON.stringify(requiredSkills) : undefined;

    await pool.query(
      `UPDATE JobVacancies
       SET Title = COALESCE(?, Title),
           Description = COALESCE(?, Description),
           EmploymentTypeId = COALESCE(?, EmploymentTypeId),
           Salary = COALESCE(?, Salary),
           Currency = COALESCE(?, Currency),
           CountryId = COALESCE(?, CountryId),
           WorkplaceTypeId = COALESCE(?, WorkplaceTypeId),
           Status = COALESCE(?, Status),
           Deadline = COALESCE(?, Deadline),
           RequiredSkills = COALESCE(?, RequiredSkills),
           UpdatedAt = CURRENT_TIMESTAMP
       WHERE Id = ?`,
      [
        title || null,
        description || null,
        employmentTypeId ? parseInt(employmentTypeId) : null,
        salary || null,
        currency || null,
        countryId ? parseInt(countryId) : null,
        workplaceTypeId ? parseInt(workplaceTypeId) : null,
        status || null,
        deadline || null,
        skillsJSON || null,
        jobId
      ]
    );

    return res.json({ success: true, message: 'Job vacancy updated successfully' });
  } catch (error) {
    console.error('Update Job Error:', error);
    return res.status(500).json({ success: false, message: 'Server error updating job vacancy' });
  }
});

// DELETE /api/jobs/:id - Delete job vacancy (company owner only)
router.delete('/:id', authenticateToken, requireRole('company'), async (req, res) => {
  const jobId = req.params.id ? req.params.id.trim() : ''; // UUID string
  const companyId = req.user.companyId;

  if (!companyId) {
    return res.status(403).json({ success: false, message: 'Unauthorized. Company profile required.' });
  }

  try {
    // Verify vacancy ownership
    const [jobs] = await pool.query('SELECT CompanyId FROM JobVacancies WHERE Id = ?', [jobId]);
    if (jobs.length === 0) {
      return res.status(404).json({ success: false, message: 'Job vacancy not found' });
    }

    if (jobs[0].CompanyId !== companyId) {
      return res.status(403).json({ success: false, message: 'Unauthorized. You do not own this job vacancy.' });
    }

    // Delete job vacancy (Cascades in DB or manual)
    await pool.query('DELETE FROM JobVacancies WHERE Id = ?', [jobId]);

    return res.json({ success: true, message: 'Job vacancy deleted successfully' });
  } catch (error) {
    console.error('Delete Job Error:', error);
    return res.status(500).json({ success: false, message: 'Server error deleting job vacancy' });
  }
});

module.exports = router;
