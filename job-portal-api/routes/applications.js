const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const pool = require('../db');
const { authenticateToken, requireRole } = require('../middleware/auth');

// POST /api/applications - Apply for a job (candidate only)
router.post('/', authenticateToken, requireRole('candidate'), async (req, res) => {
  const candidateId = req.user.candidateId;
  const { vacancy_id } = req.body;

  if (!candidateId) {
    return res.status(403).json({ success: false, message: 'Unauthorized. Candidate profile required.' });
  }

  if (!vacancy_id) {
    return res.status(400).json({ success: false, message: 'Vacancy ID is required' });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // 1. Verify job vacancy exists and is open
    const [jobs] = await connection.query(
      `SELECT Id, CompanyId, UserId as CompanyUserId, Title 
       FROM JobVacancies 
       WHERE Id = ? AND Status = 'open' AND IsActive = TRUE`,
      [vacancy_id]
    );

    if (jobs.length === 0) {
      await connection.rollback();
      return res.status(404).json({ success: false, message: 'Open job vacancy not found' });
    }

    const job = jobs[0];

    // 2. Check if candidate already applied
    const [existingApplications] = await connection.query(
      'SELECT Id FROM Applications WHERE CandidateId = ? AND VacancyId = ? AND IsActive = TRUE',
      [candidateId, vacancy_id]
    );

    if (existingApplications.length > 0) {
      await connection.rollback();
      return res.status(400).json({ success: false, message: 'You have already applied for this job vacancy' });
    }

    const applicationId = crypto.randomUUID();

    // 3. Create application
    await connection.query(
      `INSERT INTO Applications (Id, UserId, CandidateId, VacancyId, CompanyId, Status, IsActive) 
       VALUES (?, ?, ?, ?, ?, 'applied', TRUE)`,
      [applicationId, req.user.id, candidateId, vacancy_id, job.CompanyId]
    );

    await connection.commit();

    return res.status(201).json({
      success: true,
      message: 'Application submitted successfully',
      data: {
        application_id: applicationId,
        candidate_id: candidateId,
        vacancy_id,
        status: 'applied'
      }
    });
  } catch (error) {
    await connection.rollback();
    console.error('Job Application Error:', error);
    return res.status(500).json({ success: false, message: 'Server error applying for job' });
  } finally {
    connection.release();
  }
});

// GET /api/applications/:id - Get application detail (accessible by the candidate or company owner)
router.get('/:id', authenticateToken, async (req, res) => {
  const applicationId = req.params.id ? req.params.id.trim() : ''; // UUID string

  try {
    const [applications] = await pool.query(
      `SELECT a.*, jv.Title as job_title, c.Name as company_name, c.UserId as company_user_id,
              u.FirstName as candidate_first_name, u.LastName as candidate_last_name, u.Email as candidate_email,
              cand.UserId as candidate_user_id
       FROM Applications a
       JOIN JobVacancies jv ON a.VacancyId = jv.Id
       JOIN Companies c ON jv.CompanyId = c.Id
       JOIN Candidate cand ON a.CandidateId = cand.Id
       JOIN Users u ON cand.UserId = u.Id
       WHERE a.Id = ? AND a.IsActive = TRUE`,
      [applicationId]
    );

    if (applications.length === 0) {
      return res.status(404).json({ success: false, message: 'Application not found' });
    }

    const application = applications[0];

    // Authorization check: Must be candidate owner or company owner of vacancy
    const isCandidateOwner = req.user.role === 'candidate' && req.user.candidateId && application.CandidateId && req.user.candidateId.toLowerCase() === application.CandidateId.toLowerCase();
    const isCompanyOwner = req.user.role === 'company' && req.user.companyId && application.CompanyId && req.user.companyId.toLowerCase() === application.CompanyId.toLowerCase();

    if (!isCandidateOwner && !isCompanyOwner) {
      return res.status(403).json({ success: false, message: 'Access denied. Unauthorized to view application details.' });
    }

    // Format fields to match output structure expected
    const responseData = {
      id: application.Id,
      userId: application.UserId,
      candidateId: application.CandidateId,
      vacancyId: application.VacancyId,
      companyId: application.CompanyId,
      status: application.Status,
      createdAt: application.CreatedAt,
      jobTitle: application.job_title,
      companyName: application.company_name,
      candidateFirstName: application.candidate_first_name,
      candidateLastName: application.candidate_last_name,
      candidateEmail: application.candidate_email
    };

    return res.json({ success: true, data: responseData });
  } catch (error) {
    console.error('Get Application Detail Error:', error);
    return res.status(500).json({ success: false, message: 'Server error retrieving application detail' });
  }
});

// PUT /api/applications/:id - Update status (company owner only)
router.put('/:id', authenticateToken, requireRole('company'), async (req, res) => {
  const applicationId = req.params.id ? req.params.id.trim() : ''; // UUID string
  const companyId = req.user.companyId;
  const { status } = req.body;

  if (!companyId) {
    return res.status(403).json({ success: false, message: 'Unauthorized. Company profile required.' });
  }

  const validStatuses = ['applied', 'shortlisted', 'contacted', 'hired', 'rejected'];
  if (!status || !validStatuses.includes(status)) {
    return res.status(400).json({ success: false, message: 'Valid status is required (applied, shortlisted, contacted, hired, or rejected)' });
  }

  try {
    // 1. Verify application exists and company owns the job vacancy
    const [applications] = await pool.query(
      `SELECT a.Id, a.CandidateId, a.CompanyId
       FROM Applications a
       WHERE a.Id = ? AND a.IsActive = TRUE`,
      [applicationId]
    );

    if (applications.length === 0) {
      return res.status(404).json({ success: false, message: 'Application not found' });
    }

    const application = applications[0];

    if (!application.CompanyId || application.CompanyId.toLowerCase() !== companyId.toLowerCase()) {
      return res.status(403).json({ success: false, message: 'Unauthorized. You do not own the job vacancy for this application.' });
    }

    // 2. Update status
    await pool.query(
      'UPDATE Applications SET Status = ?, UpdatedAt = CURRENT_TIMESTAMP WHERE Id = ?',
      [status, applicationId]
    );

    return res.json({
      success: true,
      message: `Application status updated to ${status} successfully`
    });
  } catch (error) {
    console.error('Update Application Status Error:', error);
    return res.status(500).json({ success: false, message: 'Server error updating application status' });
  }
});

module.exports = router;
