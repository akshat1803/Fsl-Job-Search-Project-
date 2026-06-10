const express = require('express');
const router = express.Router();
const pool = require('../db');
const { authenticateToken } = require('../middleware/auth');

// GET /api/notifications - Get notifications for logged-in user
router.get('/', authenticateToken, async (req, res) => {
  try {
    const [notifications] = await pool.query(
      'SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC',
      [req.user.id]
    );

    return res.json({ success: true, data: notifications });
  } catch (error) {
    console.error('Get Notifications Error:', error);
    return res.status(500).json({ success: false, message: 'Server error retrieving notifications' });
  }
});

// PUT /api/notifications/:id - Mark notification as read
router.put('/:id', authenticateToken, async (req, res) => {
  const notificationId = parseInt(req.params.id);

  try {
    // 1. Verify notification exists and belongs to the user
    const [notifications] = await pool.query(
      'SELECT user_id FROM notifications WHERE id = ?',
      [notificationId]
    );

    if (notifications.length === 0) {
      return res.status(404).json({ success: false, message: 'Notification not found' });
    }

    if (notifications[0].user_id !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Unauthorized. You do not own this notification.' });
    }

    // 2. Mark as read
    await pool.query(
      'UPDATE notifications SET is_read = TRUE WHERE id = ?',
      [notificationId]
    );

    return res.json({ success: true, message: 'Notification marked as read' });
  } catch (error) {
    console.error('Mark Notification Read Error:', error);
    return res.status(500).json({ success: false, message: 'Server error updating notification status' });
  }
});

module.exports = router;
