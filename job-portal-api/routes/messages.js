const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const pool = require('../db');
const { authenticateToken } = require('../middleware/auth');

// GET /api/messages/conversations - Get all conversations (active chats) for logged-in user
router.get('/conversations', authenticateToken, async (req, res) => {
  const currentUserId = req.user.id;

  try {
    const query = `
      WITH LastMessages AS (
          SELECT 
              Id, SenderId, ReceiverId, Body, IsRead, CreatedAt,
              ROW_NUMBER() OVER (
                  PARTITION BY LEAST(SenderId, ReceiverId), GREATEST(SenderId, ReceiverId)
                  ORDER BY CreatedAt DESC
              ) as rn
          FROM Messages
          WHERE (SenderId = ? OR ReceiverId = ?) AND IsActive = TRUE
      )
      SELECT lm.*, 
             u.Id as contact_id, u.FirstName, u.LastName, u.UserRole
      FROM LastMessages lm
      JOIN Users u ON u.Id = CASE WHEN lm.SenderId = ? THEN lm.ReceiverId ELSE lm.SenderId END
      WHERE lm.rn = 1
      ORDER BY lm.CreatedAt DESC
    `;

    const [conversations] = await pool.query(query, [currentUserId, currentUserId, currentUserId]);

    const data = conversations.map(row => ({
      messageId: row.Id,
      body: row.Body,
      isRead: row.IsRead,
      createdAt: row.CreatedAt,
      senderId: row.SenderId,
      receiverId: row.ReceiverId,
      contact: {
        id: row.contact_id,
        firstName: row.FirstName,
        lastName: row.LastName,
        role: row.UserRole === 2 ? 'candidate' : (row.UserRole === 3 ? 'company' : 'admin')
      }
    }));

    return res.json({ success: true, data });
  } catch (error) {
    console.error('Get Conversations Error:', error);
    return res.status(500).json({ success: false, message: 'Server error retrieving conversations' });
  }
});

// GET /api/messages/user/:userId - Get message history with a specific user
router.get('/user/:userId', authenticateToken, async (req, res) => {
  const currentUserId = req.user.id;
  const targetUserId = req.params.userId ? req.params.userId.trim() : '';

  try {
    // 1. Mark incoming messages from target user to current user as read
    await pool.query(
      'UPDATE Messages SET IsRead = TRUE WHERE SenderId = ? AND ReceiverId = ? AND IsRead = FALSE',
      [targetUserId, currentUserId]
    );

    // 2. Fetch conversation history
    const [messages] = await pool.query(
      `SELECT m.*, u.FirstName as sender_first_name, u.LastName as sender_last_name
       FROM Messages m
       JOIN Users u ON m.SenderId = u.Id
       WHERE ((m.SenderId = ? AND m.ReceiverId = ?) OR (m.SenderId = ? AND m.ReceiverId = ?)) AND m.IsActive = TRUE
       ORDER BY m.CreatedAt ASC`,
      [currentUserId, targetUserId, targetUserId, currentUserId]
    );

    const formattedMessages = messages.map(m => ({
      id: m.Id,
      senderId: m.SenderId,
      receiverId: m.ReceiverId,
      body: m.Body,
      isRead: m.IsRead,
      createdAt: m.CreatedAt,
      senderFirstName: m.sender_first_name,
      senderLastName: m.sender_last_name
    }));

    return res.json({ success: true, data: formattedMessages });
  } catch (error) {
    console.error('Get Messages Error:', error);
    return res.status(500).json({ success: false, message: 'Server error retrieving messages' });
  }
});

// POST /api/messages - Send a message to a user
router.post('/', authenticateToken, async (req, res) => {
  const currentUserId = req.user.id;
  const { receiver_id, body } = req.body;

  const receiverId = receiver_id || req.body.ReceiverId;
  const messageBody = body || req.body.Body;

  if (!receiverId) {
    return res.status(400).json({ success: false, message: 'Receiver ID is required' });
  }

  if (!messageBody || messageBody.trim() === '') {
    return res.status(400).json({ success: false, message: 'Message body cannot be empty' });
  }

  try {
    // Verify receiver exists
    const [receivers] = await pool.query('SELECT Id FROM Users WHERE Id = ? AND IsActive = TRUE', [receiverId]);
    if (receivers.length === 0) {
      return res.status(404).json({ success: false, message: 'Receiver user not found' });
    }

    const messageId = crypto.randomUUID();

    await pool.query(
      `INSERT INTO Messages (Id, SenderId, ReceiverId, Body, IsRead, IsActive)
       VALUES (?, ?, ?, ?, FALSE, TRUE)`,
      [messageId, currentUserId, receiverId, messageBody.trim()]
    );

    return res.status(201).json({
      success: true,
      message: 'Message sent successfully',
      data: {
        id: messageId,
        senderId: currentUserId,
        receiverId,
        body: messageBody.trim(),
        isRead: false,
        createdAt: new Date()
      }
    });
  } catch (error) {
    console.error('Send Message Error:', error);
    return res.status(500).json({ success: false, message: 'Server error sending message' });
  }
});

module.exports = router;
