const Inspection = require("../models/inspection");
const Property = require("../models/property");
const User = require("../models/user");
const Escrow = require("../models/escrow");
const Notification = require("../models/notification");
const generateCode = require("../middlewares/generateCode");
const {
  initializeTransaction,
  verifyTransaction,
} = require("../middlewares/paystack");
const crypto = require("crypto");

// ---------------------------
// 1️⃣ Request Inspection (Allows resume if unpaid)
// ---------------------------
const requestInspection = async (req, res) => {
  try {
    const { propertyId } = req.body;
    const userId = req.user._id;

    const property = await Property.findById(propertyId);
    if (!property)
      return res
        .status(404)
        .json({ success: false, message: "Property not found" });

    // Check for existing inspection request
    const existingInspection = await Inspection.findOne({
      property: propertyId,
      user: userId,
    });

    if (existingInspection) {
      // If fee is NOT paid yet, return the existing ID so the user can resume payment seamlessly
      if (!existingInspection.feePaid) {
        return res.status(200).json({
          success: true,
          resumed: true,
          message:
            "Unpaid inspection request found. You can resume payment with this ID.",
          inspectionId: existingInspection._id,
          status: existingInspection.status,
        });
      }

      // If already paid/processed, prevent duplicate requests
      return res.status(400).json({
        success: false,
        message:
          "An active or completed inspection for this property already exists.",
        inspectionId: existingInspection._id,
        status: existingInspection.status,
      });
    }

    const code = generateCode();

    const inspection = await Inspection.create({
      property: property._id,
      owner: property.owner,
      user: userId,
      code,
      fee: property.inspectionFee,
      status: "inspection_requested",
    });

    await Notification.create({
      user: userId,
      title: "Inspection Requested",
      message: `Inspection requested for "${property.title}". Use code ${code} to verify.`,
      meta: { inspectionId: inspection._id },
    });

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
      resumed: false,
      message: "Inspection requested successfully. Proceed to payment.",
      inspectionId: inspection._id,
      code,
    });
  } catch (err) {
    console.error("requestInspection error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ---------------------------
// 2️⃣ Initialize Inspection Payment (Paystack)
// ---------------------------
const initializeInspectionPayment = async (req, res) => {
  try {
    const { inspectionId, callback_url } = req.body;
    const userId = req.user._id;

    const inspection = await Inspection.findById(inspectionId)
      .populate("owner")
      .populate("property");

    if (!inspection)
      return res
        .status(404)
        .json({ success: false, message: "Inspection not found" });

    if (inspection.user?.toString() !== userId.toString())
      return res.status(403).json({ success: false, message: "Unauthorized" });

    if (inspection.feePaid) {
      return res.status(400).json({
        success: false,
        message: "Inspection fee has already been paid.",
      });
    }

    const reference = crypto.randomBytes(16).toString("hex");

    inspection.status = "inspection_initialized";
    await inspection.save();

    await Notification.create({
      user: inspection.user,
      title: "Inspection Payment Started",
      message: `You initiated inspection payment. Escrow will be created upon successful payment.`,
      meta: { inspectionId },
    });

    if (inspection.owner) {
      await Notification.create({
        user: inspection.owner._id || inspection.owner,
        title: "Incoming Inspection Payment",
        message: `A buyer has initiated payment for inspection of your property "${inspection.property?.title}".`,
        meta: { inspectionId },
      });
    }

    if (global.io) {
      global.io.emit("notification", {
        type: "inspection_payment_started",
        title: "Inspection Payment Initiated",
        message: `A buyer has started inspection payment.`,
        inspectionId,
      });
    }

    const init = await initializeTransaction(
      req.user.email,
      inspection.fee * 100,
      reference,
      callback_url,
    );

    return res.json({
      success: true,
      authorizationUrl: init.data.authorization_url,
      reference,
      inspectionId: inspection._id,
      callback_url,
    });
  } catch (err) {
    console.error("initializeInspectionPayment error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ---------------------------
// 3️⃣ Verify Inspection Payment (Paystack)
// ---------------------------
const verifyInspectionPayment = async (req, res) => {
  try {
    const { reference, inspectionId } = req.body;

    const verification = await verifyTransaction(reference);
    if (!verification || verification.data.status !== "success") {
      return res.status(400).json({
        success: false,
        message: "Payment not successful or verification failed",
      });
    }

    const inspection = await Inspection.findById(inspectionId)
      .populate("owner")
      .populate("property");

    if (!inspection) {
      return res
        .status(404)
        .json({ success: false, message: "Inspection not found" });
    }

    let escrow = await Escrow.findOne({ reference });
    if (!escrow) {
      escrow = await Escrow.create({
        property: inspection.property?._id,
        buyer: inspection.user,
        seller: inspection.owner?._id || inspection.owner,
        amount: inspection.fee,
        status: "pending",
        reference,
        type: "inspection",
      });
    }

    const adminUser = await User.findOne({ role: "admin" });

    inspection.feePaid = true;
    inspection.escrowHeldBy = adminUser?._id;
    inspection.status = "inspection_paid";
    await inspection.save();

    await Notification.create({
      user: inspection.user,
      title: "Inspection Fee Paid",
      message: `Your inspection fee has been paid successfully. Waiting for the agent to schedule a date.`,
      meta: { inspectionId, escrowId: escrow._id },
    });

    if (inspection.owner) {
      await Notification.create({
        user: inspection.owner._id || inspection.owner,
        title: "Inspection Fee Received - Action Required",
        message: `Inspection fee for "${inspection.property?.title}" is paid. Please schedule an inspection date.`,
        meta: { inspectionId, escrowId: escrow._id },
      });
    }

    if (adminUser) {
      await Notification.create({
        user: adminUser._id,
        title: "New Escrow Created",
        message: `A new inspection payment has been verified and an escrow is pending your review.`,
        meta: { inspectionId, escrowId: escrow._id },
      });
    }

    if (global.io) {
      global.io.emit("notification", {
        type: "inspection_fee_paid",
        title: "Inspection Payment Confirmed",
        message: `Inspection fee has been verified and escrow created.`,
        inspectionId,
        escrowId: escrow._id,
      });
    }

    res.json({
      success: true,
      message:
        "Payment verified, inspection marked as paid, and escrow created successfully",
      inspection,
      escrow,
    });
  } catch (err) {
    console.error("verifyInspectionPayment error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ---------------------------
// 4️⃣ Schedule Inspection (Agent / Property Owner ONLY)
// ---------------------------
const scheduleInspection = async (req, res) => {
  try {
    const { inspectionId, scheduledDate } = req.body;
    const userId = req.user._id;

    const inspection =
      await Inspection.findById(inspectionId).populate("property");
    if (!inspection) {
      return res
        .status(404)
        .json({ success: false, message: "Inspection not found" });
    }

    const ownerId = inspection.owner?._id || inspection.owner;
    const isOwner = ownerId && ownerId.toString() === userId.toString();
    const isAgent =
      inspection.property?.agent &&
      inspection.property.agent.toString() === userId.toString();

    if (!isOwner && !isAgent && req.user.role !== "admin") {
      return res.status(403).json({
        success: false,
        message:
          "Unauthorized. Only the property owner or agent can schedule an inspection date.",
      });
    }

    if (!inspection.feePaid) {
      return res.status(400).json({
        success: false,
        message:
          "Cannot schedule date because the inspection fee has not been paid by the user yet.",
      });
    }

    inspection.scheduledDate = scheduledDate;
    inspection.status = "inspection_scheduled";
    await inspection.save();

    await Notification.create({
      user: inspection.user,
      title: "Inspection Date Scheduled",
      message: `The agent has scheduled your inspection for "${inspection.property?.title}" on ${new Date(scheduledDate).toLocaleString()}. Please confirm or reschedule if unsuitable.`,
      meta: { inspectionId },
    });

    if (global.io) {
      global.io.emit("notification", {
        type: "inspection_scheduled",
        title: "Inspection Scheduled",
        message: `An inspection date has been set by the agent for "${inspection.property?.title}".`,
        inspectionId,
      });
    }

    res.json({
      success: true,
      message: "Inspection scheduled successfully. Notified buyer.",
      inspection,
    });
  } catch (err) {
    console.error("scheduleInspection error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ---------------------------
// 5️⃣ Reschedule / Reject Inspection Date (User / Buyer)
// ---------------------------
const rescheduleInspection = async (req, res) => {
  try {
    const { inspectionId, reason } = req.body;
    const userId = req.user._id;

    const inspection =
      await Inspection.findById(inspectionId).populate("property");
    if (!inspection) {
      return res
        .status(404)
        .json({ success: false, message: "Inspection not found" });
    }

    if (inspection.user?.toString() !== userId.toString()) {
      return res.status(403).json({ success: false, message: "Unauthorized" });
    }

    if (inspection.status !== "inspection_scheduled") {
      return res.status(400).json({
        success: false,
        message:
          "You can only request a reschedule for an inspection that has a scheduled date.",
      });
    }

    // Reset back to 'inspection_paid' so the agent knows to pick a new date
    inspection.status = "inspection_paid";
    inspection.scheduledDate = null;
    await inspection.save();

    if (inspection.owner) {
      await Notification.create({
        user: inspection.owner._id || inspection.owner,
        title: "Inspection Date Rejected / Reschedule Requested",
        message: `The buyer rejected the scheduled date for "${inspection.property?.title}". Reason: ${reason || "Not suitable"}. Please pick a new date.`,
        meta: { inspectionId },
      });
    }

    if (global.io) {
      global.io.emit("notification", {
        type: "inspection_reschedule_requested",
        title: "Inspection Reschedule Requested",
        message: `Buyer rejected the inspection date for "${inspection.property?.title}".`,
        inspectionId,
      });
    }

    res.json({
      success: true,
      message:
        "Inspection date rejected. The agent has been notified to reschedule.",
      inspection,
    });
  } catch (err) {
    console.error("rescheduleInspection error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ---------------------------
// 6️⃣ Confirm / Accept Inspection (Agent / Property Owner)
// ---------------------------
const confirmInspection = async (req, res) => {
  try {
    const { inspectionId } = req.params;
    const userId = req.user._id;

    const inspection =
      await Inspection.findById(inspectionId).populate("property");
    if (!inspection) {
      return res
        .status(404)
        .json({ success: false, message: "Inspection not found" });
    }

    const ownerId = inspection.owner?._id || inspection.owner;
    const isOwner = ownerId && ownerId.toString() === userId.toString();
    const isAgent =
      inspection.property?.agent &&
      inspection.property.agent.toString() === userId.toString();

    if (!isOwner && !isAgent && req.user.role !== "admin") {
      return res.status(403).json({
        success: false,
        message:
          "Unauthorized. Only the property owner or agent can confirm this inspection.",
      });
    }

    if (inspection.status !== "inspection_scheduled") {
      return res.status(400).json({
        success: false,
        message:
          "Inspection must be scheduled first before it can be confirmed/accepted.",
      });
    }

    inspection.status = "inspection_confirmed";
    await inspection.save();

    let escrow = await Escrow.findOne({
      property: inspection.property?._id,
      buyer: inspection.user,
      type: "inspection",
    });
    if (escrow) {
      escrow.status = "approved";
      await escrow.save();
    }

    await Notification.create({
      user: inspection.user,
      title: "Inspection Confirmed",
      message: `Your inspection for "${inspection.property?.title}" has been confirmed/accepted by the agent.`,
      meta: { inspectionId },
    });

    if (global.io) {
      global.io.emit("notification", {
        type: "inspection_confirmed",
        title: "Inspection Confirmed",
        message: `Inspection confirmed for "${inspection.property?.title}".`,
        inspectionId,
      });
    }

    res.json({
      success: true,
      message: "Inspection accepted and confirmed successfully.",
      inspection,
    });
  } catch (err) {
    console.error("confirmInspection error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ---------------------------
// 7️⃣ Mark Inspection Completed (User / Buyer)
// ---------------------------
const completeInspection = async (req, res) => {
  try {
    const { inspectionId } = req.params;
    const userId = req.user._id;

    const inspection =
      await Inspection.findById(inspectionId).populate("property");
    if (!inspection) {
      return res
        .status(404)
        .json({ success: false, message: "Inspection not found" });
    }

    if (inspection.user?.toString() !== userId.toString()) {
      return res.status(403).json({ success: false, message: "Unauthorized" });
    }

    if (inspection.status !== "inspection_confirmed") {
      return res.status(400).json({
        success: false,
        message:
          "Inspection must be confirmed by the agent before it can be marked as completed.",
      });
    }

    inspection.status = "inspection_completed";
    await inspection.save();

    const adminUser = await User.findOne({ role: "admin" });

    if (inspection.owner) {
      await Notification.create({
        user: inspection.owner._id || inspection.owner,
        title: "Inspection Completed",
        message: `The inspection for "${inspection.property?.title}" has been marked as completed by the buyer.`,
        meta: { inspectionId },
      });
    }

    if (adminUser) {
      await Notification.create({
        user: adminUser._id,
        title: "Inspection Completed - Review Escrow",
        message: `Inspection for "${inspection.property?.title}" is completed. Escrow can now be processed for release.`,
        meta: { inspectionId },
      });
    }

    if (global.io) {
      global.io.emit("notification", {
        type: "inspection_completed",
        title: "Inspection Completed",
        message: `Inspection completed for "${inspection.property?.title}".`,
        inspectionId,
      });
    }

    res.json({
      success: true,
      message: "Inspection marked as completed successfully.",
      inspection,
    });
  } catch (err) {
    console.error("completeInspection error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ---------------------------
// 🔄 Change Inspection Status (Admin Fallback)
// ---------------------------
const changeInspectionStatus = async (req, res) => {
  try {
    const { inspectionId } = req.params;
    const { status } = req.body;
    const adminId = req.user._id;

    const allowedStatuses = [
      "none",
      "inspection_requested",
      "inspection_initialized",
      "inspection_paid",
      "inspection_scheduled",
      "inspection_confirmed",
      "inspection_completed",
      "inspection_cancelled",
    ];

    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Invalid inspection status provided.",
      });
    }

    const inspection = await Inspection.findById(inspectionId)
      .populate("owner")
      .populate("property");

    if (!inspection) {
      return res
        .status(404)
        .json({ success: false, message: "Inspection not found" });
    }

    inspection.status = status;
    inspection.escrowHeldBy = adminId;
    await inspection.save();

    let escrow = await Escrow.findOne({
      property: inspection.property?._id,
      buyer: inspection.user,
      type: "inspection",
    });
    if (escrow && status === "inspection_confirmed") {
      escrow.status = "approved";
      await escrow.save();
    }

    res.json({
      success: true,
      message: `Inspection status successfully updated to ${status}`,
      inspection,
      escrow,
    });
  } catch (err) {
    console.error("changeInspectionStatus error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ---------------------------
// 📋 Get Inspection Details
// ---------------------------
const getInspectionDetails = async (req, res) => {
  try {
    const { inspectionId } = req.params;

    const inspection = await Inspection.findById(inspectionId)
      .populate("property", "title price address")
      .populate("owner", "name email")
      .populate("user", "name email")
      .populate("escrowHeldBy", "name email");

    if (!inspection)
      return res
        .status(404)
        .json({ success: false, message: "Inspection not found" });

    res.json({ success: true, inspection });
  } catch (err) {
    console.error("getInspectionDetails error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ---------------------------
// 👤 Get All Inspections for User
// ---------------------------
const getUserInspections = async (req, res) => {
  try {
    const userId = req.user._id;

    const inspections = await Inspection.find({ user: userId })
      .populate("property", "title price address")
      .populate("owner", "name email")
      .populate("escrowHeldBy", "name email")
      .sort({ createdAt: -1 });

    res.json({ success: true, inspections });
  } catch (err) {
    console.error("getUserInspections error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ---------------------------
// 🏠 Get All Inspections for Agent
// ---------------------------
const getAgentInspections = async (req, res) => {
  try {
    const agentId = req.user._id;

    const properties = await Property.find(
      { agent: agentId },
      "_id title price address",
    );
    const propertyIds = properties.map((p) => p._id);

    const inspections = await Inspection.find({
      property: { $in: propertyIds },
    })
      .populate("property", "title price address")
      .populate("user", "name email")
      .populate("owner", "name email")
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

// ---------------------------
// 🛡️ Get All Inspections (Admin)
// ---------------------------
const getAllInspections = async (req, res) => {
  try {
    const inspections = await Inspection.find()
      .populate("property", "title price address")
      .populate("user", "name email")
      .populate("owner", "name email")
      .populate("escrowHeldBy", "name email")
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
  initializeInspectionPayment,
  verifyInspectionPayment,
  scheduleInspection,
  rescheduleInspection,
  confirmInspection,
  completeInspection,
  changeInspectionStatus,
  getInspectionDetails,
  getUserInspections,
  getAgentInspections,
  getAllInspections,
};
