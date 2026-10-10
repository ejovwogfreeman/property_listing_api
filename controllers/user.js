const User = require("../models/user");
const Notification = require("../models/notification");
const jwt = require("jsonwebtoken");
const { uploadImages } = require("../middlewares/cloudinary");

/**
 * @desc Get logged-in user
 */
const getMe = async (req, res) => {
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

/**
 * @desc Update user profile info
 */
const updateProfile = async (req, res) => {
  try {
    const userId = req.user._id;
    const { name, address, phoneNumber } = req.body;

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    // Only allow normal users to update
    // if (user.isGoogleUser) {
    //   return res
    //     .status(403)
    //     .json({ message: "Google users cannot update these fields" });
    // }

    // all users (both google and non google users can now update these fields)
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
      const notif = await Notification.create({
        user: admin._id,
        title: "User Profile Updated",
        message: `${user.name} updated their profile information`,
        meta: {
          updatedFields: { name, address, phoneNumber },
          userId: user._id,
        },
      });

      const adminSocketId = global.onlineUsers?.get(admin._id.toString());
      if (adminSocketId && global.io) {
        global.io.to(adminSocketId).emit("notification", notif);
      }
    }

    // Sanitize user object to remove password before sending response
    const userResponse = user.toObject();
    delete userResponse.password;

    res.json({ message: "User updated successfully", user: userResponse });
  } catch (err) {
    console.error("Update user error:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
};

/**
 * @desc Change user profile picture
 */
const changeProfilePicture = async (req, res) => {
  try {
    const userId = req.user._id;

    if (!req.files) {
      return res.status(400).json({ message: "Profile picture is required" });
    }

    const imageUrl = req.files?.images
      ? await uploadImages(req.files.images)
      : [];

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    user.profilePicture = imageUrl;
    await user.save();

    await Notification.create({
      user: user._id,
      title: "Profile Updated",
      message: `${user.name} updated their profile picture`,
      meta: { userId },
    });

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

/**
 * @desc Onboard an agent by submitting professional details and document/ID files
 */
const onboardAgent = async (req, res) => {
  try {
    const userId = req.user._id;
    const {
      phoneNumber,
      about,
      yearsOfExperience,
      serviceArea,
      languages,
      businessName,
      licenseNumber,
      officeAddress,
      socialLinkOrWebsite,
    } = req.body;

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    if (user.role !== "agent") {
      return res.status(403).json({
        message: "Only users with the agent role can complete onboarding",
      });
    }

    const governmentIdUrls = req.files?.governmentId
      ? await uploadImages(req.files.governmentId)
      : [];

    const licenseDocUrls = req.files?.licenseDoc
      ? await uploadImages(req.files.licenseDoc)
      : [];

    if (phoneNumber !== undefined) user.phoneNumber = phoneNumber;
    if (about !== undefined) user.about = about;
    if (yearsOfExperience !== undefined)
      user.yearsOfExperience = yearsOfExperience;

    if (serviceArea !== undefined) {
      try {
        user.serviceArea =
          typeof serviceArea === "string"
            ? JSON.parse(serviceArea)
            : serviceArea;
      } catch (e) {
        user.serviceArea =
          typeof serviceArea === "string"
            ? serviceArea.split(",").map((s) => s.trim())
            : serviceArea;
      }
    }

    if (languages !== undefined) {
      try {
        user.languages =
          typeof languages === "string" ? JSON.parse(languages) : languages;
      } catch (e) {
        user.languages =
          typeof languages === "string"
            ? languages.split(",").map((l) => l.trim())
            : languages;
      }
    }

    if (businessName !== undefined) user.businessName = businessName;
    if (licenseNumber !== undefined) user.licenseNumber = licenseNumber;
    if (officeAddress !== undefined) user.officeAddress = officeAddress;
    if (socialLinkOrWebsite !== undefined)
      user.socialLinkOrWebsite = socialLinkOrWebsite;

    user.governmentId = governmentIdUrls;
    user.licenseDoc = licenseDocUrls;
    user.isOnboarding = true;

    await user.save();

    const admins = await User.find({ role: "admin" });
    for (const admin of admins) {
      const notif = await Notification.create({
        user: admin._id,
        title: "Agent Onboarded",
        message: `${user.name} submitted their agent onboarding details`,
        meta: { userId: user._id },
      });

      const adminSocketId = global.onlineUsers?.get(admin._id.toString());
      if (adminSocketId && global.io) {
        global.io.to(adminSocketId).emit("notification", notif);
      }
    }

    // Sanitize user object
    const userResponse = user.toObject();
    delete userResponse.password;

    return res.status(200).json({
      success: true,
      message: "Agent onboarding submitted successfully",
      user: userResponse,
    });
  } catch (err) {
    console.error("onboardAgent error:", err);
    return res
      .status(500)
      .json({ message: "Server error", error: err.message });
  }
};

/**
 * @desc Get all agents (Public route)
 */
const getAllAgents = async (req, res) => {
  try {
    const agents = await User.find({ role: "agent" }).select(
      "name email phoneNumber profilePicture isVerified about yearsOfExperience serviceArea languages businessName licenseNumber officeAddress socialLinkOrWebsite isOnboarding rating totalListings createdAt",
    );

    return res.status(200).json({
      success: true,
      message: "Agents fetched successfully",
      total: agents.length,
      data: agents,
    });
  } catch (error) {
    console.error("getAllAgents error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

/**
 * @desc Get all users (Admin/General route - password excluded)
 */
const getAllUsers = async (req, res) => {
  try {
    const users = await User.find().select("-password");

    return res.status(200).json({
      success: true,
      message: "All users fetched successfully",
      total: users.length,
      data: users,
    });
  } catch (error) {
    console.error("getAllUsers error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

/**
 * @desc Get a particular agent by ID (Public route)
 */
const getAgentProfile = async (req, res) => {
  try {
    const { id } = req.params;

    const agent = await User.findOne({ _id: id, role: "agent" }).select(
      "name email phoneNumber profilePicture isVerified about yearsOfExperience serviceArea languages businessName licenseNumber officeAddress socialLinkOrWebsite isOnboarding rating totalListings createdAt",
    );

    if (!agent) {
      return res.status(404).json({
        success: false,
        message: "Agent not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Agent fetched successfully",
      data: agent,
    });
  } catch (error) {
    console.error("getAgentProfile error:", error);

    if (error.kind === "ObjectId") {
      return res.status(400).json({
        success: false,
        message: "Invalid agent ID format",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

/**
 * @desc Complete standard user onboarding (sets isOnboarding to true)
 */
const onboardUser = async (req, res) => {
  try {
    const userId = req.user._id;

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    // Verify user is a standard user
    if (user.role !== "user") {
      return res.status(403).json({
        message:
          "Only users with the standard user role can complete this onboarding",
      });
    }

    // anybody can now access this route
    // Only update isOnboarding to true
    user.isOnboarding = true;

    await user.save();

    // Sanitize user object to remove password
    const userResponse = user.toObject();
    delete userResponse.password;

    return res.status(200).json({
      success: true,
      message: "User onboarding completed successfully",
      user: userResponse,
    });
  } catch (err) {
    console.error("onboardUser error:", err);
    return res
      .status(500)
      .json({ message: "Server error", error: err.message });
  }
};

/**
 * @desc Upgrade user account role from 'user' to 'agent'
 */
const upgradeUser = async (req, res) => {
  try {
    const userId = req.user._id;

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    // Check if user is already an agent
    if (user.role !== "user") {
      return res.status(400).json({
        success: false,
        message: "Your account is already an agent account",
      });
    }

    // Upgrade role to agent
    user.role = "agent";

    // Reset isOnboarding to false so they can proceed with filling out their agent profile/documents
    user.isOnboarding = false;

    await user.save();

    // Sanitize user object to remove password
    const userResponse = user.toObject();
    delete userResponse.password;

    return res.status(200).json({
      success: true,
      message:
        "Account upgraded to agent successfully. Please proceed with agent onboarding.",
      user: userResponse,
    });
  } catch (err) {
    console.error("upgrade User error:", err);
    return res
      .status(500)
      .json({ message: "Server error", error: err.message });
  }
};

/**
 * @desc Get user profile by ID (Public/Protected route)
 */
const getUserProfile = async (req, res) => {
  try {
    const { id } = req.params;

    const user = await User.findOne({ _id: id, role: "user" }).select(
      "name profilePicture address phoneNumber rating createdAt isOnboarding",
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "User fetched successfully",
      data: user,
    });
  } catch (error) {
    console.error("getUserProfile error:", error);

    if (error.kind === "ObjectId") {
      return res.status(400).json({
        success: false,
        message: "Invalid user ID format",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

module.exports = {
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
};
