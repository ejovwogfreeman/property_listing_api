// routes/user.js
const express = require("express");
const router = express.Router();
const multer = require("multer");

// Middlewares
const { protect } = require("../middlewares/auth"); // middleware to get req.user from JWT
const {
  getMe,
  updateProfile,
  changeProfilePicture,
  getAllAgents,
} = require("../controllers/user");
const { uploadProfilePicture } = require("../middlewares/upload");

// Multer setup for single file upload (profile picture)
const storage = multer.memoryStorage();
const upload = multer({ storage });

// ===============================
// USER ROUTES
// ===============================

// Get logged-in user
router.get("/me", protect, getMe);

// Update profile (normal users only)
router.put("/update-profile", protect, updateProfile);

// Change profile picture (all users)
router.post(
  "/change-profile-picture",
  protect,
  uploadProfilePicture,
  changeProfilePicture,
);

// Get all agents
router.get("/agents", getAllAgents);

module.exports = router;
