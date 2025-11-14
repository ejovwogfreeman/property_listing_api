const express = require("express");
const router = express.Router();
const authController = require("../controllers/auth");
const { protect } = require("../middlewares/auth");
// const { authorize } = require("../middlewares/auth-role");

// ------------------------
// Normal registration
// Body: { name, email, password, role }
router.post("/register", authController.register);

// ------------------------
// Normal login
// Body: { email, password }
router.post("/login", authController.login);

// ------------------------
// Google OAuth login
// Body: { tokenId } (from Google Sign-In)
router.post("/google", authController.googleAuth);

// ------------------------
// Get logged-in user info
router.get("/me", protect, authController.getMe);

// router.get("/send-email", authController.sendEmail);

// ------------------------
// Optional: Admin-only route example
// router.get("/all-users", protect, authorize("admin"), authController.getAllUsers);

module.exports = router;
