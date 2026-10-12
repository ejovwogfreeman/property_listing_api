const express = require("express");
const router = express.Router();
const {
  submitFeedback,
  getAllFeedback,
  getMyFeedback,
  getFeedbackById,
  updateFeedback,
  deleteFeedback,
} = require("../controllers/feedback");
const { protect, authorize } = require("../middlewares/auth"); // middleware to get req.user from JWT

// POST: Submit feedback (Authenticated users/agents)
router.post("/", protect, submitFeedback);

// GET: Get all feedback (Agents and Admins only)
router.get("/", protect, authorize("admin", "agent"), getAllFeedback);

// GET: Get logged-in user's feedback
router.get("/my", protect, getMyFeedback);

// GET feedback by ID
router.get("/:id", protect, getFeedbackById);

// PUT: Update feedback by ID (Owner or Admin)
router.put("/:id", protect, updateFeedback);

// DELETE: Delete feedback by ID (Owner or Admin)
router.delete("/:id", protect, deleteFeedback);

module.exports = router;
