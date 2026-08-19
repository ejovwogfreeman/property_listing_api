const Ad = require("../models/ads");
const Property = require("../models/property");
const User = require("../models/user");
const Notification = require("../models/notification");

/**
 * @desc Create a new property ad (Agent only)
 * @route POST /api/ads
 */
const createAd = async (req, res) => {
  try {
    // Restrict ad creation strictly to agents
    if (req.user.role !== "agent") {
      return res.status(403).json({
        success: false,
        message: "Only agents are allowed to create property advertisements",
      });
    }

    const { property, objective, dailyBudget, duration, adBudget } = req.body;
    const userId = req.user._id;

    // Verify property exists and belongs to the agent
    const prop = await Property.findById(property);
    if (!prop) {
      return res
        .status(404)
        .json({ success: false, message: "Property not found" });
    }

    if (prop.owner._id.toString() !== userId.toString()) {
      return res.status(403).json({
        success: false,
        message: "Not authorized to advertise a property you do not own",
      });
    }

    // Check if there is already an active or pending ad for this property
    const existingAd = await Ad.findOne({
      property,
      status: { $in: ["pending", "active"] },
    });

    if (existingAd) {
      return res.status(400).json({
        success: false,
        message:
          "An active or pending ad already exists for this property. You cannot create a new one until it completes or is removed.",
      });
    }

    // Calculate total adBudget automatically if not provided or to ensure accuracy
    const calculatedBudget = adBudget || dailyBudget * duration;

    const newAd = await Ad.create({
      user: userId,
      property,
      objective,
      dailyBudget,
      duration,
      adBudget: calculatedBudget,
      status: "pending", // Strictly initialized as pending
      isPaid: false,
    });

    // Populate property details for the response
    await newAd.populate("property");

    // Notify user & admins
    await Notification.create({
      user: userId,
      title: "Ad Created",
      message: `Your ad campaign for "${prop.title}" has been created as pending. Proceed to pay from your balance.`,
      meta: { adId: newAd._id },
    });

    res.status(201).json({
      success: true,
      message:
        "Ad created successfully as pending. Proceed to payment from your balance.",
      data: newAd,
    });
  } catch (err) {
    console.error("createAd error:", err);
    res
      .status(500)
      .json({ success: false, message: "Server error", error: err.message });
  }
};

/**
 * @desc Pay for an ad using the user's wallet balance and activate it
 * @route POST /api/ads/:id/pay
 */
const payForAd = async (req, res) => {
  try {
    const ad = await Ad.findById(req.params.id);
    if (!ad) {
      return res.status(404).json({ success: false, message: "Ad not found" });
    }

    // Check ownership
    if (ad.user.toString() !== req.user._id.toString()) {
      return res
        .status(403)
        .json({ success: false, message: "Not authorized" });
    }

    if (ad.isPaid) {
      return res
        .status(400)
        .json({ success: false, message: "Ad has already been paid for" });
    }

    // Fetch user to check wallet balance
    const user = await User.findById(req.user._id);
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    const currentBalance = user.balance || user.walletBalance || 0;

    if (currentBalance < ad.adBudget) {
      return res.status(400).json({
        success: false,
        message: `Insufficient wallet balance. Required: ${ad.adBudget}, Available: ${currentBalance}`,
      });
    }

    // Deduct from wallet & save user
    user.balance = currentBalance - ad.adBudget; // change to user.walletBalance if applicable
    await user.save();

    // Update ad payment details and automatically set status to active upon payment success
    ad.isPaid = true;
    ad.spent = ad.adBudget;
    ad.status = "active";
    await ad.save();
    await ad.populate("property");

    // Send Notification
    await Notification.create({
      user: ad.user,
      title: "Ad Payment Successful & Activated",
      message: `Successfully paid ${ad.adBudget} from your balance. Your ad is now active!`,
      meta: { adId: ad._id },
    });

    res.status(200).json({
      success: true,
      message: "Ad payment successful and campaign is now active",
      data: ad,
    });
  } catch (err) {
    console.error("payForAd error:", err);
    res
      .status(500)
      .json({ success: false, message: "Server error", error: err.message });
  }
};

/**
 * @desc Get all ads (Admins see all, agents see their own)
 * @route GET /api/ads
 */
const getAds = async (req, res) => {
  try {
    let query = {};
    if (req.user.role !== "admin") {
      query.user = req.user._id;
    }

    const ads = await Ad.find(query)
      .populate("property")
      .populate("user", "name email profilePicture");

    res.status(200).json({
      success: true,
      total: ads.length,
      data: ads,
    });
  } catch (err) {
    console.error("getAds error:", err);
    res
      .status(500)
      .json({ success: false, message: "Server error", error: err.message });
  }
};

/**
 * @desc Get a single ad by ID
 * @route GET /api/ads/:id
 */
const getAd = async (req, res) => {
  try {
    const ad = await Ad.findById(req.params.id)
      .populate("property")
      .populate("user", "name email profilePicture");

    if (!ad) {
      return res.status(404).json({ success: false, message: "Ad not found" });
    }

    if (
      ad.user._id.toString() !== req.user._id.toString() &&
      req.user.role !== "admin"
    ) {
      return res
        .status(403)
        .json({ success: false, message: "Not authorized" });
    }

    res.status(200).json({
      success: true,
      data: ad,
    });
  } catch (err) {
    console.error("getAd error:", err);
    res
      .status(500)
      .json({ success: false, message: "Server error", error: err.message });
  }
};

/**
 * @desc Update an ad (Agents update details, Admin changes status/pauseReason)
 * @route PATCH /api/ads/:id
 */
const updateAd = async (req, res) => {
  try {
    const { objective, dailyBudget, duration, adBudget, status, pauseReason } =
      req.body;

    const ad = await Ad.findById(req.params.id);
    if (!ad) {
      return res.status(404).json({ success: false, message: "Ad not found" });
    }

    const isAdmin = req.user.role === "admin";
    const isOwner = ad.user.toString() === req.user._id.toString();

    if (!isAdmin && !isOwner) {
      return res
        .status(403)
        .json({ success: false, message: "Not authorized" });
    }

    // Validate status input if provided against allowed schema values
    const allowedStatuses = ["pending", "active", "completed", "paused"];
    if (status !== undefined && !allowedStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Invalid status value provided.",
      });
    }

    // If the user is an admin, they can update status arbitrarily and change pauseReason
    if (isAdmin) {
      if (status !== undefined) ad.status = status;
      if (pauseReason !== undefined) ad.pauseReason = pauseReason;
    }

    // If the user is the owner (agent)
    if (isOwner) {
      // Handle agent status updates: strictly allowed only between "active" and "paused"
      if (status !== undefined) {
        const isValidToggle =
          (ad.status === "active" && status === "paused") ||
          (ad.status === "paused" && status === "active");

        if (!isValidToggle) {
          return res.status(403).json({
            success: false,
            message:
              "Agents can only toggle status between 'active' and 'paused'.",
          });
        }
        ad.status = status;

        // If agent pauses it, they can optionally provide or clear a pauseReason, or you can manage it here
        if (pauseReason !== undefined) ad.pauseReason = pauseReason;
      }

      // Campaign field modifications (allowed only if unpaid)
      if (ad.isPaid && (objective || dailyBudget || duration || adBudget)) {
        return res.status(400).json({
          success: false,
          message:
            "Cannot modify campaign details after payment has been completed.",
        });
      }

      if (objective !== undefined) ad.objective = objective;
      if (dailyBudget !== undefined) ad.dailyBudget = dailyBudget;
      if (duration !== undefined) ad.duration = duration;

      if (dailyBudget !== undefined || duration !== undefined) {
        ad.adBudget = adBudget || ad.dailyBudget * ad.duration;
      } else if (adBudget !== undefined) {
        ad.adBudget = adBudget;
      }
    }

    await ad.save();
    await ad.populate("property");

    res.status(200).json({
      success: true,
      message: "Ad updated successfully",
      data: ad,
    });
  } catch (err) {
    console.error("updateAd error:", err);
    res
      .status(500)
      .json({ success: false, message: "Server error", error: err.message });
  }
};

/**
 * @desc Delete an ad
 * @route DELETE /api/ads/:id
 */
const deleteAd = async (req, res) => {
  try {
    const ad = await Ad.findById(req.params.id);
    if (!ad) {
      return res.status(404).json({ success: false, message: "Ad not found" });
    }

    if (
      ad.user.toString() !== req.user._id.toString() &&
      req.user.role !== "admin"
    ) {
      return res
        .status(403)
        .json({ success: false, message: "Not authorized" });
    }

    await ad.deleteOne();

    res.status(200).json({
      success: true,
      message: "Ad deleted successfully",
    });
  } catch (err) {
    console.error("deleteAd error:", err);
    res
      .status(500)
      .json({ success: false, message: "Server error", error: err.message });
  }
};

module.exports = {
  createAd,
  payForAd,
  getAds,
  getAd,
  updateAd,
  deleteAd,
};
