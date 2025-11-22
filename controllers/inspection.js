const Inspection = require("../models/Inspection");
const Property = require("../models/Property");
const User = require("../models/User");
const Notification = require("../models/Notification");
const { generateCode } = require("../middlewares/codeGenerator");
const {
  initializeTransaction,
  verifyTransaction,
} = require("../middlewares/paystack");
const crypto = require("crypto");

// ---------------------------
// 1️⃣ Request Inspection
// ---------------------------
requestInspection = async (req, res) => {
  try {
    const { propertyId } = req.body;
    const userId = req.user._id;

    // Fetch property
    const property = await Property.findById(propertyId);
    if (!property)
      return res.status(404).json({ message: "Property not found" });

    // Generate 6-digit code
    const code = generateCode();

    // Create inspection record
    const inspection = await Inspection.create({
      property: property._id,
      owner: property.owner, // store property owner
      user: userId,
      code,
      fee: property.inspectionFee,
    });

    // Notification to user
    await Notification.create({
      user: userId,
      title: "Inspection Requested",
      message: `Inspection requested for "${property.title}". Use code ${code} to verify.`,
      meta: { inspectionId: inspection._id },
    });

    // Emit socket.io event
    if (global.io) {
      global.io.emit("notification", {
        type: "inspection_requested",
        title: "Inspection Requested",
        message: `Inspection requested for "${property.title}"`,
        inspectionId: inspection._id,
      });
    }

    res.status(201).json({
      success: true,
      message: "Inspection code generated. Please verify it before paying.",
      inspectionId: inspection._id,
      code, // remove in production
    });
  } catch (err) {
    console.error("requestInspection error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ---------------------------
// 2️⃣ Verify Inspection Code
// ---------------------------
verifyInspectionCode = async (req, res) => {
  try {
    const { inspectionId, code } = req.body;
    const userId = req.user._id;

    const inspection = await Inspection.findById(inspectionId);
    if (!inspection)
      return res.status(404).json({ message: "Inspection not found" });
    if (inspection.user.toString() !== userId.toString())
      return res.status(403).json({ message: "Unauthorized" });
    if (inspection.status === "verified")
      return res.status(400).json({ message: "Inspection already verified" });
    if (inspection.code !== code)
      return res.status(400).json({ message: "Incorrect code" });

    inspection.status = "verified";
    await inspection.save();

    // Notification to user
    await Notification.create({
      user: userId,
      title: "Inspection Verified",
      message: `Inspection code verified for property.`,
      meta: { inspectionId },
    });

    // Socket.io event
    if (global.io) {
      global.io.emit("notification", {
        type: "inspection_verified",
        title: "Inspection Verified",
        message: `Inspection code verified`,
        inspectionId,
      });
    }

    res.json({
      success: true,
      message: "Code verified. You can now pay the inspection fee.",
    });
  } catch (err) {
    console.error("verifyInspectionCode error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ---------------------------
// 3️⃣ Initialize Inspection Payment (Paystack)
// ---------------------------
initializeInspectionPayment = async (req, res) => {
  try {
    const { inspectionId } = req.body;
    const userId = req.user._id;

    const inspection = await Inspection.findById(inspectionId).populate(
      "owner"
    );
    if (!inspection)
      return res.status(404).json({ message: "Inspection not found" });
    if (inspection.user.toString() !== userId.toString())
      return res.status(403).json({ message: "Unauthorized" });
    if (inspection.status !== "verified")
      return res
        .status(400)
        .json({ message: "Inspection must be verified first" });
    if (inspection.feePaid)
      return res.status(400).json({ message: "Inspection fee already paid" });

    // Generate unique reference
    const reference = crypto.randomBytes(16).toString("hex");

    // Initialize transaction with Paystack
    const init = await initializeTransaction(
      req.user.email,
      inspection.fee * 100,
      reference
    ); // amount in kobo

    res.json({
      success: true,
      authorizationUrl: init.data.authorization_url,
      reference,
      inspectionId: inspection._id,
    });
  } catch (err) {
    console.error("initializeInspectionPayment error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ---------------------------
// 4️⃣ Verify Inspection Payment (Paystack)
// ---------------------------
verifyInspectionPayment = async (req, res) => {
  try {
    const { reference, inspectionId } = req.body;

    const verification = await verifyTransaction(reference);
    if (verification.data.status !== "success")
      return res.status(400).json({ message: "Payment not successful" });

    const inspection = await Inspection.findById(inspectionId);
    if (!inspection)
      return res.status(404).json({ message: "Inspection not found" });

    const adminUser = await User.findOne({ role: "admin" });

    inspection.feePaid = true;
    inspection.escrowHeldBy = adminUser._id;
    await inspection.save();

    // Notification to user
    await Notification.create({
      user: inspection.user,
      title: "Inspection Fee Paid",
      message: `Your inspection fee has been paid and is held in escrow by admin.`,
      meta: { inspectionId },
    });

    // Notification to property owner
    await Notification.create({
      user: inspection.owner,
      title: "Property Inspection Paid",
      message: `Your property "${inspection.property}" has been inspected and fee paid.`,
      meta: { inspectionId },
    });

    // Socket.io event
    if (global.io) {
      global.io.emit("notification", {
        type: "inspection_fee_paid",
        title: "Inspection Fee Paid",
        message: `Inspection fee for property paid and held in escrow`,
        inspectionId,
      });
    }

    res.json({
      success: true,
      message: "Payment verified successfully",
      inspection,
    });
  } catch (err) {
    console.error("verifyInspectionPayment error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ---------------------------
// 5️⃣ Get Inspection Details
// ---------------------------
getInspectionDetails = async (req, res) => {
  try {
    const { inspectionId } = req.params;

    const inspection = await Inspection.findById(inspectionId)
      .populate("property", "title price address") // property info
      .populate("owner", "name email") // property owner
      .populate("user", "name email") // person requesting inspection
      .populate("escrowHeldBy", "name email"); // admin holding escrow

    if (!inspection)
      return res.status(404).json({ message: "Inspection not found" });

    res.json({ success: true, inspection });
  } catch (err) {
    console.error("getInspectionDetails error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ---------------------------
// Get All Inspections for Logged-in User
// ---------------------------
getUserInspections = async (req, res) => {
  try {
    const userId = req.user._id;

    const inspections = await Inspection.find({ user: userId })
      .populate("property", "title price address")
      .populate("owner", "name email") // property owner
      .populate("escrowHeldBy", "name email") // admin holding fee
      .sort({ createdAt: -1 });

    res.json({ success: true, inspections });
  } catch (err) {
    console.error("getMyInspections error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// Get all inspections of properties managed by the logged-in agent
getAgentInspections = async (req, res) => {
  try {
    const agentId = req.user._id;

    // Fetch properties where the logged-in user is the agent
    const properties = await Property.find(
      { agent: agentId },
      "_id title price address"
    );
    const propertyIds = properties.map((p) => p._id);

    // Get inspections for these properties
    const inspections = await Inspection.find({
      property: { $in: propertyIds },
    })
      .populate("property", "title price address")
      .populate("user", "name email") // requester
      .populate("owner", "name email") // property owner
      .populate("escrowHeldBy", "name email")
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      properties,
      inspections,
    });
  } catch (err) {
    console.error("getAgentInspections error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// Get all inspections in the system
getAllInspections = async (req, res) => {
  try {
    const inspections = await Inspection.find()
      .populate("property", "title price address")
      .populate("user", "name email") // requester
      .populate("owner", "name email") // property owner
      .populate("escrowHeldBy", "name email") // admin
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      inspections,
    });
  } catch (err) {
    console.error("getAllInspections error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = {
  requestInspection,
  verifyInspectionCode,
  initializeInspectionPayment,
  verifyInspectionPayment,
  getInspectionDetails,
  getUserInspections,
  getAgentInspections,
  getAllInspections,
};
