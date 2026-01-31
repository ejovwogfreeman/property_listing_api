const User = require("../models/user");
const Notification = require("../models/notification");
const jwt = require("jsonwebtoken");
const { OAuth2Client } = require("google-auth-library");
const Email = require("../middlewares/email");
const generateCode = require("../middlewares/generateCode");
const { uploadImages } = require("../middlewares/cloudinary");

/**
 * @desc Get logged-in user
 */
getMe = async (req, res) => {
  try {
    const authHeader = req.header("Authorization");
    if (!authHeader)
      return res.status(401).json({ message: "No token provided" });

    const token = authHeader.replace("Bearer ", "").trim();
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const user = await User.findById(decoded.id).select("-password");
    if (!user) return res.status(404).json({ message: "User not found" });

    res.json({
      success: true,
      user,
    });
  } catch (err) {
    console.error("GetMe error:", err.message);

    if (err.name === "TokenExpiredError")
      return res.status(401).json({ message: "Token expired" });

    res.status(401).json({ message: "Invalid or missing token" });
  }
};

updateProfile = async (req, res) => {
  try {
    const userId = req.user._id;
    const { name, address, phoneNumber } = req.body;

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    // Only allow normal users to update
    if (user.isGoogleUser) {
      return res
        .status(403)
        .json({ message: "Google users cannot update these fields" });
    }

    // Update allowed fields
    if (name) user.name = name;
    if (address) user.address = address;
    if (phoneNumber) user.phoneNumber = phoneNumber;

    await user.save();

    // ---------------------------
    // NOTIFY ADMINS
    // ---------------------------
    const admins = await User.find({ role: "admin" });

    for (const admin of admins) {
      // Create notification in DB
      const notif = await Notification.create({
        user: admin._id,
        title: "User Profile Updated",
        message: `${user.name} updated their profile information`,
        meta: {
          updatedFields: { name, address, phoneNumber },
          userId: user._id,
        },
      });

      // Emit live notification via socket if admin is online
      const adminSocketId = global.onlineUsers.get(admin._id.toString());
      if (adminSocketId) {
        global.io.to(adminSocketId).emit("notification", notif);
      }
    }

    res.json({ message: "User updated successfully", user });
  } catch (err) {
    console.error("Update user error:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
};

changeProfilePicture = async (req, res) => {
  try {
    const userId = req.user._id;

    if (!req.file) {
      return res.status(400).json({ message: "Profile picture is required" });
    }

    // Upload the new image (returns the URL or path)
    const imageUrl = await uploadImage(req.file, "profile_pictures");

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    // Update profile picture
    user.profilePicture = imageUrl;
    await user.save();

    // Send notification to admin (optional)
    await Notification.create({
      user: user._id,
      title: "Profile Updated",
      message: `${user.name} updated their profile picture`,
      meta: { userId },
    });

    // Emit socket notification to admin or relevant users
    if (global.io) {
      global.io.emit("notification", {
        type: "profile_picture_updated",
        title: "Profile Picture Updated",
        message: `${user.name} changed their profile picture`,
        userId,
      });
    }

    res.json({
      message: "Profile picture updated successfully",
      profilePicture: imageUrl,
    });
  } catch (err) {
    console.error("changeProfilePicture error:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
};

module.exports = {
  getMe,
  updateProfile,
  changeProfilePicture,
  changeProfilePicture,
};
