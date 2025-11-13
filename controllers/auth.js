const User = require("../models/user");
const Notification = require("../models/notification");
const jwt = require("jsonwebtoken");
const { OAuth2Client } = require("google-auth-library");

// const genToken = (id) =>
//   jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: "30d" });

const genToken = (user) => {
  return jwt.sign(
    {
      id: user._id,
      role: user.role, // include the role
    },
    process.env.JWT_SECRET,
    { expiresIn: "30d" }
  );
};

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

/**
 * @desc Register with email/password
 */
exports.register = async (req, res) => {
  try {
    const { name, email, password, role } = req.body;

    if (!name || !email || !password)
      return res.status(400).json({ message: "Missing fields" });

    const exists = await User.findOne({ email });
    if (exists)
      return res.status(400).json({ message: "Email already exists" });

    const user = await User.create({ name, email, password, role });

    // Create notification
    await Notification.create({
      user: user._id,
      title: "Welcome!",
      message: `Hello ${name}, your account has been successfully created.`,
      meta: { userId: user._id },
    });

    // Real-time notification
    if (global.io)
      global.io.emit("notification", {
        type: "user_registered",
        title: "New Registration",
        message: `${name} just registered.`,
        userId: user._id,
      });

    res.status(201).json({
      token: genToken(user._id),
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
    });
  } catch (err) {
    console.error("Register error:", err);
    res.status(500).json({ message: "Server error" });
  }
};

/**
 * @desc Login with email/password
 */
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.status(401).json({ message: "Invalid credentials" });

    const ok = await user.comparePassword(password);
    if (!ok) return res.status(401).json({ message: "Invalid credentials" });

    // Create login notification
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
      token: genToken(user._id),
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
 * @desc Google OAuth login/register
 */
exports.googleAuth = async (req, res) => {
  try {
    const { tokenId, mode } = req.body; // mode = "register" or "login"
    if (!tokenId)
      return res.status(400).json({ message: "Missing Google token" });

    const ticket = await googleClient.verifyIdToken({
      idToken: tokenId,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

    const { email, name, picture } = ticket.getPayload();
    let user = await User.findOne({ email });

    if (mode === "register") {
      if (user) {
        return res
          .status(400)
          .json({ message: "User already exists. Please login instead." });
      }

      // Create new user
      user = await User.create({
        name,
        email,
        password: "GOOGLE_AUTH_USER", // placeholder
        role: "user",
        avatar: picture,
        isGoogleUser: true,
      });

      await Notification.create({
        user: user._id,
        title: "Welcome via Google",
        message: `Your account was created via Google OAuth.`,
        meta: { userId: user._id },
      });

      if (global.io)
        global.io.emit("notification", {
          type: "google_register",
          title: "Google Registration",
          message: `${name} joined via Google.`,
          userId: user._id,
        });
    } else if (mode === "login") {
      if (!user) {
        return res
          .status(404)
          .json({ message: "User not found. Please register first." });
      }
      if (!user.isGoogleUser) {
        return res
          .status(400)
          .json({ message: "Please login using email/password." });
      }

      await Notification.create({
        user: user._id,
        title: "Google Login",
        message: `You logged in successfully via Google.`,
        meta: { userId: user._id },
      });

      if (global.io)
        global.io.emit("notification", {
          type: "google_login",
          title: "Google Login",
          message: `${user.name} logged in via Google.`,
          userId: user._id,
        });
    } else {
      return res.status(400).json({ message: "Invalid mode" });
    }

    res.json({
      token: genToken(user),
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
        role: user.role,
        avatar: user.avatar,
      },
    });
  } catch (err) {
    console.error("Google auth error:", err);
    res.status(500).json({ message: "Google authentication failed" });
  }
};

/**
 * @desc Get currently logged-in user
 * @route GET /api/auth/me
 * @access Private
 */

exports.getMe = async (req, res) => {
  try {
    // 🔹 Extract token from headers
    const authHeader = req.header("Authorization");
    if (!authHeader) {
      return res
        .status(401)
        .json({ success: false, message: "No token provided" });
    }

    const token = authHeader.replace("Bearer ", "").trim();

    // 🔹 Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // 🔹 Find user
    const user = await User.findById(decoded.id).select("-password");
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    // 🔹 Return success response
    res.json({
      success: true,
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
        role: user.role,
        avatar: user.avatar,
      },
    });
  } catch (err) {
    console.error("GetMe error:", err.message);

    if (err.name === "TokenExpiredError") {
      return res.status(401).json({ success: false, message: "Token expired" });
    }

    res
      .status(401)
      .json({ success: false, message: "Invalid or missing token" });
  }
};
