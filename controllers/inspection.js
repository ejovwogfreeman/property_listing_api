const Inspection = require("../models/Inspection");
const Property = require("../models/Property");
const User = require("../models/User");
const Escrow = require("../models/Escrow");
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

    const inspection = await Inspection.findById(inspectionId)
      .populate("owner")
      .populate("property");

    if (!inspection)
      return res.status(404).json({ message: "Inspection not found" });

    if (inspection.user.toString() !== userId.toString())
      return res.status(403).json({ message: "Unauthorized" });

    if (inspection.status !== "verified")
      return res.status(400).json({
        message: "Inspection must be verified first",
      });

    if (inspection.feePaid)
      return res.status(400).json({
        message: "Inspection fee already paid",
      });

    // Generate unique transaction reference
    const reference = crypto.randomBytes(16).toString("hex");

    // 👉 CREATE ESCROW ENTRY
    const escrow = await Escrow.create({
      property: inspection.property?._id,
      buyer: userId,
      seller: inspection.owner?._id,
      amount: inspection.fee,
      status: "pending",
      reference,
      type: "inspection",
    });

    // -----------------------------------------------------------
    // 🔔 GLOBAL NOTIFICATIONS USING YOUR OWN FORMAT
    // -----------------------------------------------------------

    // Notify buyer
    await Notification.create({
      user: inspection.user,
      title: "Inspection Payment Started",
      message: `You initiated inspection payment. Your money will be held in escrow until verification.`,
      meta: { inspectionId, escrowId: escrow._id },
    });

    // Notify property owner
    await Notification.create({
      user: inspection.owner,
      title: "Incoming Inspection Payment",
      message: `A buyer has initiated payment for inspection of your property "${inspection.property?.title}".`,
      meta: { inspectionId, escrowId: escrow._id },
    });

    // SOCKET (global)
    if (global.io) {
      global.io.emit("notification", {
        type: "inspection_payment_started",
        title: "Inspection Payment Initiated",
        message: `A buyer has started inspection payment (escrow created).`,
        inspectionId,
        escrowId: escrow._id,
      });
    }

    // -----------------------------------------------------------
    // Initialize Paystack transaction
    // -----------------------------------------------------------
    const init = await initializeTransaction(
      req.user.email,
      inspection.fee * 100, // convert to kobo
      reference
    );

    return res.json({
      success: true,
      authorizationUrl: init.data.authorization_url,
      reference,
      inspectionId: inspection._id,
      escrowId: escrow._id,
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
    if (verification.data.status !== "success") {
      return res.status(400).json({ message: "Payment not successful" });
    }

    // Find inspection
    const inspection = await Inspection.findById(inspectionId)
      .populate("owner")
      .populate("property");

    if (!inspection) {
      return res.status(404).json({ message: "Inspection not found" });
    }

    // Find related escrow (created during initialize)
    const escrow = await Escrow.findOne({ reference });
    if (!escrow) {
      return res
        .status(404)
        .json({ message: "Escrow record not found for this transaction" });
    }

    // Find admin
    const adminUser = await User.findOne({ role: "admin" });

    // Update Inspection fields
    inspection.feePaid = true;
    inspection.escrowHeldBy = adminUser._id;
    await inspection.save();

    // Update Escrow fields
    escrow.status = "approved";
    escrow.approvedAt = new Date();
    await escrow.save();

    // -------------------------------------------------------------
    // 🔔 NOTIFICATIONS
    // -------------------------------------------------------------

    // Notify buyer
    await Notification.create({
      user: inspection.user,
      title: "Inspection Fee Paid",
      message: `Your inspection fee has been paid successfully and is being held in escrow by admin.`,
      meta: { inspectionId, escrowId: escrow._id },
    });

    // Notify property owner
    await Notification.create({
      user: inspection.owner,
      title: "Inspection Fee Received",
      message: `The inspection fee for your property "${inspection.property?.title}" has been paid and the funds are held in escrow.`,
      meta: { inspectionId, escrowId: escrow._id },
    });

    // Notify admin
    await Notification.create({
      user: adminUser._id,
      title: "New Escrow Payment",
      message: `A new inspection escrow payment has been approved.`,
      meta: { inspectionId, escrowId: escrow._id },
    });

    // -------------------------------------------------------------
    // 🔌 SOCKET EVENTS
    // -------------------------------------------------------------
    if (global.io) {
      global.io.emit("notification", {
        type: "inspection_fee_paid",
        title: "Inspection Payment Approved",
        message: `Inspection fee has been verified and escrow updated.`,
        inspectionId,
        escrowId: escrow._id,
      });
    }

    // SUCCESS RESPONSE
    res.json({
      success: true,
      message: "Payment verified successfully",
      inspection,
      escrow,
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
