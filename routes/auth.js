const express = require("express");
const router = express.Router();
// const authController = require("../controllers/auth");
const {
  register,
  verifyAccount,
  resendVerificationCode,
  login,
  googleAuth,
  forgetPassword,
  changePassword,
} = require("../controllers/auth");
const { protect } = require("../middlewares/auth");
const { uploadNone } = require("../middlewares/upload");

// ------------------------
// Normal registration
// Body: { name, email, password, role }
router.post("/register", uploadNone, register);

// ------------------------
// Account Verification
// Body: { email, code }
router.post("/verify", verifyAccount);

// ------------------------
// Account Verification
// Body: { email, code }
router.post("/resend-verification", resendVerificationCode);

// ------------------------
// Normal login
// Body: { email, password }
router.post("/login", uploadNone, login);

// ------------------------
// Google OAuth login
// Body: { tokenId } (from Google Sign-In)
router.post("/google", googleAuth);

// Normal login
// Body: { email }
router.post("/forget-password", forgetPassword);

// Normal login
// Body: { email, code, newPassword }
router.post("/change-password", forgetPassword);

// ------------------------
// Get logged-in user info
// router.get("/me", protect, getMe);

// router.get("/send-email", sendEmail);

// ------------------------
// Optional: Admin-only route example
// router.get("/all-users", protect, authorize("admin"), getAllUsers);

module.exports = router;
