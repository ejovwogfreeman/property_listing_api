const express = require("express");
const router = express.Router();
// const authController = require("../controllers/auth");
const {
  register,
  verifyAccount,
  login,
  googleAuth,
  getMe,
} = require("../controllers/auth");
const { protect } = require("../middlewares/auth");
// const { authorize } = require("../middlewares/auth-role");

// ------------------------
// Normal registration
// Body: { name, email, password, role }
router.post("/register", register);

// ------------------------
// Account Verification
// Body: { email, code }
router.post("/verify", verifyAccount);

// ------------------------
// Normal login
// Body: { email, password }
router.post("/login", login);

// ------------------------
// Google OAuth login
// Body: { tokenId } (from Google Sign-In)
router.post("/google", googleAuth);

// ------------------------
// Get logged-in user info
router.get("/me", protect, getMe);

// router.get("/send-email", sendEmail);

// ------------------------
// Optional: Admin-only route example
// router.get("/all-users", protect, authorize("admin"), getAllUsers);

module.exports = router;
