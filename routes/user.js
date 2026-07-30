// routes/user.js
const express = require("express");
const router = express.Router();
const multer = require("multer");

// Middlewares
const { protect, authorize } = require("../middlewares/auth"); // middleware to get req.user from JWT
const {
  getMe,
  updateProfile,
  changeProfilePicture,
  onboardAgent,
  getAllAgents,
  getAllUsers,
} = require("../controllers/user");
const {
  uploadProfilePicture,
  uploadOnboardingFiles,
} = require("../middlewares/upload");

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

// PUT or PATCH endpoint to onboard the agent
router.patch(
  "/onboard-agent",
  protect,
  authorize("agent"),
  uploadOnboardingFiles,
  onboardAgent,
);

// Get all agents
router.get("/agents", getAllAgents);

// get all users
router.get("/agents", protect, authorize("admin"), getAllUsers);

module.exports = router;
