const Ad = require("../models/ads");
const Property = require("../models/property");
const Notification = require("../models/notification");
const {
  initializeTransaction,
  verifyTransaction,
} = require("../middlewares/paystack");
const crypto = require("crypto");

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

    // Calculate total adBudget automatically if not provided or to ensure accuracy
    const calculatedBudget = adBudget || dailyBudget * duration;

    const newAd = await Ad.create({
      user: userId,
      property,
      objective,
      dailyBudget,
      duration,
      adBudget: calculatedBudget,
      status: "pending", // Starts as pending until admin reviews/confirms
      isPaid: false,
    });

    // Populate property details for the response
    await newAd.populate("property");

    // Notify user & admins
    await Notification.create({
      user: userId,
      title: "Ad Created",
      message: `Your ad campaign for "${prop.title}" has been created. Proceed to payment.`,
      meta: { adId: newAd._id },
    });

    res.status(201).json({
      success: true,
      message: "Ad created successfully. Proceed to payment.",
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
 * @desc Initialize Paystack payment for an existing ad
 * @route POST /api/ads/:id/pay
 */
/**
 * @desc Initialize Paystack payment for an existing ad
 * @route POST /api/ads/:id/pay
 */
const initializeAdPayment = async (req, res) => {
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

    const email = req.user.email;

    // Ensure amount is a clean integer representing kobo (e.g., 2500 * 100 = 250000)
    const amount = Math.round(Number(ad.adBudget) * 100);

    if (isNaN(amount) || amount <= 0) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid ad budget amount" });
    }

    const reference = `AD_${crypto.randomBytes(6).toString("hex")}_${Date.now()}`;

    // Call your middleware function matching your parameter style: (email, amount, reference)
    // Note: If you want to include metadata, you can either update your paystack middleware
    // or pass it if your paystack implementation supports a 4th argument.
    // Using your exact middleware parameters:
    const paymentData = await initializeTransaction(email, amount, reference);

    // Save reference temporarily on the ad model
    ad.paymentReference = reference;
    await ad.save();

    res.status(200).json({
      success: true,
      message: "Payment initialized successfully",
      data: paymentData, // Returns Paystack auth_url and reference
    });
  } catch (err) {
    console.error("initializeAdPayment error:", err);
    res
      .status(500)
      .json({ success: false, message: "Server error", error: err.message });
  }
};

/**
 * @desc Verify Paystack payment and mark as paid (Admin can then change status to active)
 * @route GET /api/ads/verify-payment
 */
/**
 * @desc Verify Paystack payment and mark as paid
 * @route GET /api/ads/verify-payment
 */
/**
 * @desc Verify Paystack payment and mark as paid
 * @route POST /api/ads/verify-payment
 */
const verifyAdPayment = async (req, res) => {
  try {
    // Change req.query to req.body since it's a POST request
    const { reference } = req.body;
    if (!reference) {
      return res
        .status(400)
        .json({ success: false, message: "Payment reference is required" });
    }

    // Call your middleware function matching your exact format: verifyTransaction(reference)
    const verification = await verifyTransaction(reference);

    // Paystack verify response returns verification.status = true and verification.data.status = "success"
    if (
      !verification ||
      !verification.status ||
      verification.data?.status !== "success"
    ) {
      return res
        .status(400)
        .json({ success: false, message: "Payment verification failed" });
    }

    // Find the ad using the paymentReference saved during initialization
    const ad = await Ad.findOne({ paymentReference: reference });
    if (!ad) {
      return res.status(404).json({
        success: false,
        message: "Ad not found for this transaction reference",
      });
    }

    // Update ad payment status
    ad.isPaid = true;
    await ad.save();
    await ad.populate("property");

    // Notify user
    await Notification.create({
      user: ad.user,
      title: "Ad Payment Successful",
      message: `Your payment was verified successfully. Awaiting admin activation.`,
      meta: { adId: ad._id },
    });

    res.status(200).json({
      success: true,
      message: "Payment verified successfully",
      data: ad,
    });
  } catch (err) {
    console.error("verifyAdPayment error:", err);
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
 * @desc Update an ad (Agents update details, Admin changes status after payment review)
 * @route PATCH /api/ads/:id
 */
/**
 * @desc Update an ad
 * @route PATCH /api/ads/:id
 */
const updateAd = async (req, res) => {
  try {
    const { objective, dailyBudget, duration, adBudget, status } = req.body;

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

    // Strict Rule: If someone who is NOT an admin tries to change the status
    if (status !== undefined && !isAdmin) {
      return res.status(403).json({
        success: false,
        message: "Only administrators are allowed to update ad status.",
      });
    }

    // If the user is an admin, they can update the status
    if (isAdmin) {
      if (status !== undefined) ad.status = status;
    }

    // If the user is the owner (agent), they can update campaign details (if unpaid)
    if (isOwner) {
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
  initializeAdPayment,
  verifyAdPayment,
  getAds,
  getAd,
  updateAd,
  deleteAd,
};
