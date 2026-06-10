const express = require('express');
const router = express.Router();
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

    // 1. Verify job vacancy exists and is active
    const [jobs] = await connection.query(
      `SELECT jv.id, jv.title, jv.company_id, c.user_id as company_user_id 
       FROM job_vacancies jv
       JOIN companies c ON jv.company_id = c.id
       WHERE jv.id = ? AND jv.status = 'active'`,
      [vacancy_id]
    );

    if (jobs.length === 0) {
      await connection.rollback();
      return res.status(404).json({ success: false, message: 'Active job vacancy not found' });
    }

    const job = jobs[0];

    // 2. Check if candidate already applied
    const [existingApplications] = await connection.query(
      'SELECT id FROM applications WHERE candidate_id = ? AND vacancy_id = ?',
      [candidateId, vacancy_id]
    );

    if (existingApplications.length > 0) {
      await connection.rollback();
      return res.status(400).json({ success: false, message: 'You have already applied for this job vacancy' });
    }

    // 3. Create application
    const [result] = await connection.query(
      'INSERT INTO applications (candidate_id, vacancy_id, status) VALUES (?, ?, ?)',
      [candidateId, vacancy_id, 'pending']
    );

    // Fetch candidate's name for notification
    const [candidateUser] = await connection.query(
      'SELECT first_name, last_name FROM users WHERE id = ?',
      [req.user.id]
    );
    const candidateName = candidateUser.length > 0 
      ? `${candidateUser[0].first_name} ${candidateUser[0].last_name}` 
      : 'A candidate';

    // 4. Send notification to the company
    await connection.query(
      'INSERT INTO notifications (user_id, type, message) VALUES (?, ?, ?)',
      [
        job.company_user_id,
        'application',
        `${candidateName} has applied for your job vacancy: ${job.title}.`
      ]
    );

    await connection.commit();

    return res.status(201).json({
      success: true,
      message: 'Application submitted successfully',
      data: {
        application_id: result.insertId,
        candidate_id: candidateId,
        vacancy_id,
        status: 'pending'
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
  const applicationId = parseInt(req.params.id);

  try {
    const [applications] = await pool.query(
      `SELECT a.*, jv.title as job_title, jv.company_id, c.name as company_name, c.user_id as company_user_id,
             u.first_name as candidate_first_name, u.last_name as candidate_last_name, u.email as candidate_email,
             cand.user_id as candidate_user_id
       FROM applications a
       JOIN job_vacancies jv ON a.vacancy_id = jv.id
       JOIN companies c ON jv.company_id = c.id
       JOIN candidates cand ON a.candidate_id = cand.id
       JOIN users u ON cand.user_id = u.id
       WHERE a.id = ?`,
      [applicationId]
    );

    if (applications.length === 0) {
      return res.status(404).json({ success: false, message: 'Application not found' });
    }

    const application = applications[0];

    // Authorization check: Must be candidate owner or company owner of vacancy
    const isCandidateOwner = req.user.role === 'candidate' && req.user.candidateId === application.candidate_id;
    const isCompanyOwner = req.user.role === 'company' && req.user.companyId === application.company_id;

    if (!isCandidateOwner && !isCompanyOwner) {
      return res.status(403).json({ success: false, message: 'Access denied. Unauthorized to view application details.' });
    }

    return res.json({ success: true, data: application });
  } catch (error) {
    console.error('Get Application Detail Error:', error);
    return res.status(500).json({ success: false, message: 'Server error retrieving application detail' });
  }
});

// PUT /api/applications/:id - Update status (company owner only)
router.put('/:id', authenticateToken, requireRole('company'), async (req, res) => {
  const applicationId = parseInt(req.params.id);
  const companyId = req.user.companyId;
  const { status } = req.body;

  if (!companyId) {
    return res.status(403).json({ success: false, message: 'Unauthorized. Company profile required.' });
  }

  const validStatuses = ['pending', 'shortlisted', 'hired', 'rejected'];
  if (!status || !validStatuses.includes(status)) {
    return res.status(400).json({ success: false, message: 'Valid status is required (pending, shortlisted, hired, or rejected)' });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // 1. Verify application exists and company owns the job vacancy
    const [applications] = await connection.query(
      `SELECT a.id, a.candidate_id, jv.title as job_title, jv.company_id, cand.user_id as candidate_user_id, c.name as company_name
       FROM applications a
       JOIN job_vacancies jv ON a.vacancy_id = jv.id
       JOIN companies c ON jv.company_id = c.id
       JOIN candidates cand ON a.candidate_id = cand.id
       WHERE a.id = ?`,
      [applicationId]
    );

    if (applications.length === 0) {
      await connection.rollback();
      return res.status(404).json({ success: false, message: 'Application not found' });
    }

    const application = applications[0];

    if (application.company_id !== companyId) {
      await connection.rollback();
      return res.status(403).json({ success: false, message: 'Unauthorized. You do not own the job vacancy for this application.' });
    }

    // 2. Update status
    await connection.query(
      'UPDATE applications SET status = ? WHERE id = ?',
      [status, applicationId]
    );

    // 3. Send notification to candidate
    await connection.query(
      'INSERT INTO notifications (user_id, type, message) VALUES (?, ?, ?)',
      [
        application.candidate_user_id,
        'application_status',
        `Your application status for "${application.job_title}" at ${application.company_name} has been updated to "${status}".`
      ]
    );

    await connection.commit();

    return res.json({
      success: true,
      message: `Application status updated to ${status} successfully`
    });
  } catch (error) {
    await connection.rollback();
    console.error('Update Application Status Error:', error);
    return res.status(500).json({ success: false, message: 'Server error updating application status' });
  } finally {
    connection.release();
  }
});

module.exports = router;
