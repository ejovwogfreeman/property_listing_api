// routes/user.js
const express = require("express");
const router = express.Router();
const multer = require("multer");

// Middlewares
const { protect, authorize } = require("../middlewares/auth"); // middleware to get req.user from JWT
const trackActivity = require("../middlewares/trackActivity");
const {
  uploadProfilePicture,
  uploadOnboardingFiles,
} = require("../middlewares/upload");

const {
  getMe,
  updateProfile,
  changeProfilePicture,
  onboardAgent,
  getAllAgents,
  getAllUsers,
  getAgentProfile,
  onboardUser,
  upgradeUser,
  getUserProfile,
  updateAgentRiskLevel,
  updateAgentVerification,
  moderateUserAccount,
} = require("../controllers/user");

// ===============================
// USER ROUTES
// ===============================

// Get logged-in user
router.get("/me", protect, trackActivity, getMe);

// Update profile (normal users only)
router.put("/update-profile", protect, trackActivity, updateProfile);

// Change profile picture (all users)
router.post(
  "/change-profile-picture",
  protect,
  trackActivity,
  uploadProfilePicture,
  changeProfilePicture,
);

// PUT or PATCH endpoint to onboard the agent
router.patch(
  "/onboard-agent",
  protect,
  authorize("agent"),
  trackActivity,
  uploadOnboardingFiles,
  onboardAgent,
);

// PUT or PATCH endpoint to onboard the user
router.patch(
  "/onboard-user",
  protect,
  trackActivity,
  uploadOnboardingFiles,
  onboardUser,
);

// PUT or PATCH endpoint to upgrade user
router.patch("/upgrade-user", protect, trackActivity, upgradeUser);

// Get all agents (public route, no protect needed)
router.get("/agents", getAllAgents);

// Get all users (admin only)
router.get("/users", protect, authorize("admin"), trackActivity, getAllUsers);

// Get agent profile (public route)
router.get("/agents/:id", getAgentProfile);

// Get user profile (protected)
router.get("/users/:id", protect, trackActivity, getUserProfile);

// PATCH: Update an agent's risk level (Admin only)
router.patch("/agents/:id/risk", protect, trackActivity, updateAgentRiskLevel);

// Admin only routes
router.patch(
  "/agents/:id/verification",
  protect,
  authorize("admin"),
  trackActivity,
  updateAgentVerification,
);
router.patch(
  "/users/:id/moderate",
  protect,
  authorize("admin"),
  trackActivity,
  moderateUserAccount,
);

module.exports = router;
