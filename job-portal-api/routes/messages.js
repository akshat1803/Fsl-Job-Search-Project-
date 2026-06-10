const express = require('express');
const router = express.Router();
const pool = require('../db');
const { authenticateToken } = require('../middleware/auth');

// GET /api/messages/conversations - Get all conversations for logged-in user
router.get('/conversations', authenticateToken, async (req, res) => {
  const isCandidate = req.user.role === 'candidate';
  const isCompany = req.user.role === 'company';

  try {
    let conversations = [];

    if (isCandidate) {
      const candidateId = req.user.candidateId;
      if (!candidateId) {
        return res.status(400).json({ success: false, message: 'Candidate profile required.' });
      }

      [conversations] = await pool.query(
        `SELECT c.id, c.candidate_id, c.company_id, c.created_at, comp.name as company_name, comp.logo_url as company_logo,
                m.body as last_message, m.created_at as last_message_time, m.sender_id as last_message_sender_id
         FROM conversations c
         JOIN companies comp ON c.company_id = comp.id
         LEFT JOIN (
             SELECT conversation_id, body, created_at, sender_id 
             FROM messages
             WHERE id IN (SELECT MAX(id) FROM messages GROUP BY conversation_id)
         ) m ON c.id = m.conversation_id
         WHERE c.candidate_id = ?
         ORDER BY COALESCE(m.created_at, c.created_at) DESC`,
        [candidateId]
      );
    } else if (isCompany) {
      const companyId = req.user.companyId;
      if (!companyId) {
        return res.status(400).json({ success: false, message: 'Company profile required.' });
      }

      [conversations] = await pool.query(
        `SELECT c.id, c.candidate_id, c.company_id, c.created_at, u.first_name as candidate_first_name, u.last_name as candidate_last_name, u.avatar_url as candidate_avatar,
                m.body as last_message, m.created_at as last_message_time, m.sender_id as last_message_sender_id
         FROM conversations c
         JOIN candidates cand ON c.candidate_id = cand.id
         JOIN users u ON cand.user_id = u.id
         LEFT JOIN (
             SELECT conversation_id, body, created_at, sender_id 
             FROM messages
             WHERE id IN (SELECT MAX(id) FROM messages GROUP BY conversation_id)
         ) m ON c.id = m.conversation_id
         WHERE c.company_id = ?
         ORDER BY COALESCE(m.created_at, c.created_at) DESC`,
        [companyId]
      );
    } else {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }

    return res.json({ success: true, data: conversations });
  } catch (error) {
    console.error('Get Conversations Error:', error);
    return res.status(500).json({ success: false, message: 'Server error retrieving conversations' });
  }
});

// GET /api/messages/conversations/:id - Get messages in a conversation
router.get('/conversations/:id', authenticateToken, async (req, res) => {
  const conversationId = parseInt(req.params.id);

  try {
    // 1. Verify user is part of this conversation
    const [conversations] = await pool.query(
      'SELECT candidate_id, company_id FROM conversations WHERE id = ?',
      [conversationId]
    );

    if (conversations.length === 0) {
      return res.status(404).json({ success: false, message: 'Conversation not found' });
    }

    const conversation = conversations[0];
    const isCandidateOwner = req.user.role === 'candidate' && req.user.candidateId === conversation.candidate_id;
    const isCompanyOwner = req.user.role === 'company' && req.user.companyId === conversation.company_id;

    if (!isCandidateOwner && !isCompanyOwner) {
      return res.status(403).json({ success: false, message: 'Access denied. You are not a participant in this conversation.' });
    }

    // 2. Mark incoming messages as read (messages where sender_id != current user)
    await pool.query(
      'UPDATE messages SET is_read = TRUE WHERE conversation_id = ? AND sender_id != ?',
      [conversationId, req.user.id]
    );

    // 3. Fetch all messages in conversation
    const [messages] = await pool.query(
      `SELECT m.*, u.first_name, u.last_name, u.avatar_url
       FROM messages m
       JOIN users u ON m.sender_id = u.id
       WHERE m.conversation_id = ?
       ORDER BY m.created_at ASC`,
      [conversationId]
    );

    return res.json({ success: true, data: messages });
  } catch (error) {
    console.error('Get Messages Error:', error);
    return res.status(500).json({ success: false, message: 'Server error retrieving messages' });
  }
});

// POST /api/messages/conversations - Start new conversation
router.post('/conversations', authenticateToken, async (req, res) => {
  const { candidate_id, company_id } = req.body;

  // Verify parameters
  let targetCandidateId;
  let targetCompanyId;

  if (req.user.role === 'candidate') {
    targetCandidateId = req.user.candidateId;
    targetCompanyId = parseInt(company_id);
    if (!targetCompanyId) {
      return res.status(400).json({ success: false, message: 'Company ID is required to start a conversation' });
    }
  } else if (req.user.role === 'company') {
    targetCompanyId = req.user.companyId;
    targetCandidateId = parseInt(candidate_id);
    if (!targetCandidateId) {
      return res.status(400).json({ success: false, message: 'Candidate ID is required to start a conversation' });
    }
  } else {
    return res.status(403).json({ success: false, message: 'Access denied' });
  }

  try {
    // 1. Check if conversation already exists
    const [existing] = await pool.query(
      'SELECT id FROM conversations WHERE candidate_id = ? AND company_id = ?',
      [targetCandidateId, targetCompanyId]
    );

    if (existing.length > 0) {
      return res.json({
        success: true,
        message: 'Conversation already exists',
        data: { conversation_id: existing[0].id }
      });
    }

    // 2. Validate existence of candidate and company
    const [candidates] = await pool.query('SELECT id FROM candidates WHERE id = ?', [targetCandidateId]);
    if (candidates.length === 0) {
      return res.status(404).json({ success: false, message: 'Candidate not found' });
    }

    const [companies] = await pool.query('SELECT id FROM companies WHERE id = ?', [targetCompanyId]);
    if (companies.length === 0) {
      return res.status(404).json({ success: false, message: 'Company not found' });
    }

    // 3. Create new conversation
    const [result] = await pool.query(
      'INSERT INTO conversations (candidate_id, company_id) VALUES (?, ?)',
      [targetCandidateId, targetCompanyId]
    );

    return res.status(201).json({
      success: true,
      message: 'Conversation started successfully',
      data: { conversation_id: result.insertId }
    });
  } catch (error) {
    console.error('Start Conversation Error:', error);
    return res.status(500).json({ success: false, message: 'Server error starting conversation' });
  }
});

// POST /api/messages/:conversationId - Send a message
router.post('/:conversationId', authenticateToken, async (req, res) => {
  const conversationId = parseInt(req.params.conversationId);
  const { body } = req.body;

  if (!body || body.trim() === '') {
    return res.status(400).json({ success: false, message: 'Message body cannot be empty' });
  }

  try {
    // 1. Check conversation exists and user is participant
    const [conversations] = await pool.query(
      'SELECT candidate_id, company_id FROM conversations WHERE id = ?',
      [conversationId]
    );

    if (conversations.length === 0) {
      return res.status(404).json({ success: false, message: 'Conversation not found' });
    }

    const conversation = conversations[0];
    const isCandidateOwner = req.user.role === 'candidate' && req.user.candidateId === conversation.candidate_id;
    const isCompanyOwner = req.user.role === 'company' && req.user.companyId === conversation.company_id;

    if (!isCandidateOwner && !isCompanyOwner) {
      return res.status(403).json({ success: false, message: 'Access denied. You are not a participant in this conversation.' });
    }

    // 2. Insert message
    const [result] = await pool.query(
      'INSERT INTO messages (conversation_id, sender_id, body, is_read) VALUES (?, ?, ?, FALSE)',
      [conversationId, req.user.id, body.trim()]
    );

    return res.status(201).json({
      success: true,
      message: 'Message sent successfully',
      data: {
        id: result.insertId,
        conversation_id: conversationId,
        sender_id: req.user.id,
        body: body.trim(),
        is_read: false,
        created_at: new Date()
      }
    });
  } catch (error) {
    console.error('Send Message Error:', error);
    return res.status(500).json({ success: false, message: 'Server error sending message' });
  }
});

module.exports = router;
