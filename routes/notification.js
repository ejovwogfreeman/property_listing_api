const express = require("express");
const router = express.Router();
const {
  getMyNotifications,
  getAllNotifications,
  markAsRead,
  markAllAsRead,
  deleteNotification,
} = require("../controllers/notification");
const { protect, authorize } = require("../middlewares/auth");

// GET: Fetch notifications for the logged-in user / admin
router.get("/", protect, getMyNotifications);

// GET: Fetch ALL system notifications across the platform (Admin only)
// Note: Placed above parameterized routes like /:id to prevent routing collision
router.get("/all", protect, getAllNotifications);

// PATCH: Mark all notifications as read
router.patch("/read-all", protect, markAllAsRead);

// PATCH: Mark a specific notification as read by ID
router.patch("/:id/read", protect, markAsRead);

// DELETE: Delete a notification by ID
router.delete("/:id", protect, deleteNotification);

module.exports = router;
