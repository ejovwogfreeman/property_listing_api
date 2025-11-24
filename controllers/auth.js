const User = require("../models/user");
const Notification = require("../models/notification");
const jwt = require("jsonwebtoken");
const { OAuth2Client } = require("google-auth-library");
const Email = require("../middlewares/email");
const generateCode = require("../middlewares/generateCode");

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

const genToken = (user) => {
  return jwt.sign(
    {
      id: user._id,
      role: user.role,
    },
    process.env.JWT_SECRET,
    { expiresIn: "30d" }
  );
};

/**
 * @desc Register user + send verification code
 */
register = async (req, res) => {
  try {
    const { name, email, password, role } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ message: "Missing fields" });
    }

    const exists = await User.findOne({ email });
    if (exists)
      return res.status(400).json({ message: "Email already exists" });

    // Generate verification code
    const verificationCode = generateCode();

    const user = await User.create({
      name,
      email,
      password,
      role,
      verificationCode,
      isVerified: false,
      isGoogleUser: false,
    });

    // Email the verification code
    await Email(
      user.email,
      "Verify Your Account",
      "register.html",
      { EMAIL: email, CODE: verificationCode } // dynamic value
    );

    // Create notification
    await Notification.create({
      user: user._id,
      title: "Verify Your Email",
      message: `Enter the verification code sent to ${email}.`,
      meta: { userId: user._id },
    });

    if (global.io)
      global.io.emit("notification", {
        type: "user_registered",
        title: "New Registration",
        message: `${email} registered and needs to verify email.`,
        userId: user._id,
      });

    res.status(201).json({
      message: "Account created. Verification code sent to your email.",
      userId: user._id,
    });
  } catch (err) {
    console.error("Register error:", err);
    res.status(500).json({ message: "Server error" });
  }
};

/**
 * @desc Verify account with code
 */
verifyAccount = async (req, res) => {
  try {
    const { email, code } = req.body;

    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ message: "User not found" });

    if (user.isVerified)
      return res.status(400).json({ message: "Account already verified" });

    if (user.verificationCode !== Number(code))
      return res.status(400).json({ message: "Invalid verification code" });

    user.isVerified = true;
    user.verificationCode = null;
    await user.save();

    // Email the verification code
    await Email(
      user.email,
      "Verify Your Account",
      "verify.html",
      { EMAIL: email } // dynamic value
    );

    await Notification.create({
      user: user._id,
      title: "Account Verified",
      message: "Your email verification was successful!",
      meta: { userId: user._id },
    });

    if (global.io)
      global.io.emit("notification", {
        type: "user_verified",
        title: "New User Verified",
        message: `${email} registered and verified successfully.`,
        userId: user._id,
      });

    res.status(200).json({ message: "Account verified successfully!" });
  } catch (err) {
    console.error("Verify error:", err);
    res.status(500).json({ message: "Verification failed" });
  }
};

/**
 * @desc Login with email/password
 */
login = async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email });
    if (!user) return res.status(401).json({ message: "Invalid credentials" });

    if (!user.isVerified)
      return res
        .status(401)
        .json({ message: "Please verify your email before logging in." });

    if (user.isGoogleUser)
      return res
        .status(400)
        .json({ message: "Please login using Google OAuth" });

    const ok = await user.comparePassword(password);
    if (!ok) return res.status(401).json({ message: "Invalid credentials" });

    // Email the verification code
    await Email(
      user.email,
      "Login Successful",
      "login.html",
      { EMAIL: email } // dynamic value
    );

    await Notification.create({
      user: user._id,
      title: "Login Successful",
      message: `You logged in successfully.`,
      meta: { userId: user._id },
    });

    if (global.io)
      global.io.emit("notification", {
        type: "user_login",
        title: "User Logged In",
        message: `${user.name} logged in.`,
        userId: user._id,
      });

    res.json({
      token: genToken(user),
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
    });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ message: "Server error" });
  }
};

/**
 * @desc Google OAuth register/login
 */

googleAuth = async (req, res) => {
  try {
    const { tokenId, mode } = req.body; // "register" or "login"

    if (!tokenId) {
      return res.status(400).json({ message: "Missing Google token" });
    }

    if (!["register", "login"].includes(mode)) {
      return res.status(400).json({ message: "Invalid mode" });
    }

    // 🔍 Verify Google token
    const ticket = await googleClient.verifyIdToken({
      idToken: tokenId,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

    const { email, name, picture } = ticket.getPayload();
    let user = await User.findOne({ email });

    // =====================================
    // 🔵 REGISTER MODE
    // =====================================
    if (mode === "register") {
      if (user) {
        return res.status(400).json({
          message: "User already exists. Please login instead.",
        });
      }

      // Generate verification code
      const verificationCode = generateCode();

      // Create user
      user = await User.create({
        name,
        email,
        password: "GOOGLE_AUTH_PLACEHOLDER", // will be skipped because isGoogleUser = true
        avatar: picture,
        isGoogleUser: true,
        isVerified: false,
        verificationCode,
      });

      // Email the verification code
      try {
        await Email(
          user.email,
          "Verify Your Account",
          "register.html",
          { EMAIL: email, CODE: verificationCode } // dynamic value
        );
      } catch (mailErr) {
        console.error("Email sending failed:", mailErr);
      }

      // 🔔 Create notification inside DB
      await Notification.create({
        user: user._id,
        title: "Verify Your Email",
        message: `Hello ${name}, please verify your email to activate your account.`,
        meta: { userId: user._id },
      });

      // 🔔 Emit socket notification
      if (global.io) {
        global.io.emit("notification", {
          type: "google_register",
          title: "Google Registration",
          message: `${name} joined via Google. Verification email sent.`,
          userId: user._id,
        });
      }

      return res.status(201).json({
        success: true,
        message:
          "Account created via Google. Verification code sent to your email.",
        userId: user._id,
      });
    }

    // =====================================
    // 🟢 LOGIN MODE
    // =====================================
    if (mode === "login") {
      if (!user) {
        return res.status(404).json({
          message: "User not found. Please register first.",
        });
      }

      if (!user.isGoogleUser) {
        return res
          .status(400)
          .json({ message: "Please login using email/password." });
      }

      if (!user.isVerified) {
        return res
          .status(401)
          .json({ message: "Please verify your email before logging in." });
      }

      // 📧 Send login email
      try {
        await Email(email, "Login Successful", "login.html", {
          EMAIL: email,
        });
      } catch (mailErr) {
        console.error("Login email failed:", mailErr);
      }

      // 🔔 Store notification
      await Notification.create({
        user: user._id,
        title: "Google Login",
        message: `You logged in successfully via Google.`,
        meta: { userId: user._id },
      });

      // 🔔 Emit real-time socket message
      if (global.io) {
        global.io.emit("notification", {
          type: "google_login",
          title: "Google Login",
          message: `${user.name} logged in via Google.`,
          userId: user._id,
        });
      }

      return res.json({
        success: true,
        token: genToken(user._id), // FIXED 🔥
        user: {
          id: user._id,
          email: user.email,
          name: user.name,
          role: user.role,
          avatar: user.avatar,
        },
      });
    }
  } catch (err) {
    console.error("Google auth error:", err);
    return res.status(500).json({
      message: "Google authentication failed",
      error: err.message,
    });
  }
};

module.exports = {
  register,
  verifyAccount,
  login,
  googleAuth,
};
