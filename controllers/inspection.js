const Inspection = require("../models/inspection");
const Purchase = require("../models/purchase");
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

// Helper for targeted socket notifications
const notifyUser = (userId, event, data) => {
  if (global.io && userId) {
    global.io.to(userId.toString()).emit(event, data);
  }
};

const notifyBoth = (buyerId, agentId, event, data) => {
  notifyUser(buyerId, event, data);
  notifyUser(agentId, event, data);
};

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

    const existingInspection = await Inspection.findOne({
      property: propertyId,
      user: userId,
    });

    if (existingInspection) {
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

      return res.status(400).json({
        success: false,
        message:
          "An active or completed inspection for this property already exists.",
        inspectionId: existingInspection._id,
        status: existingInspection.status,
      });
    }

    const code = generateCode();
    const inspectionFee = property.inspectionFee || 0;
    const platformFee = 0;

    const inspection = await Inspection.create({
      property: property._id,
      owner: property.owner,
      user: userId,
      code,
      fee: inspectionFee,
      platformFee: platformFee,
      status: "inspection_requested",
    });

    await Notification.create({
      user: userId,
      title: "Inspection Requested",
      message: `Inspection requested for "${property.title}". Use code ${code} to verify.`,
      meta: { inspectionId: inspection._id },
    });

    notifyUser(userId, "notification", {
      type: "inspection_requested",
      title: "Inspection Requested",
      message: `Inspection requested for "${property.title}"`,
      inspectionId: inspection._id,
      status: inspection.status,
    });

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
    inspection.reference = reference;
    inspection.initializedAt = new Date();
    await inspection.save();

    await Notification.create({
      user: inspection.user,
      title: "Inspection Payment Started",
      message: `You initiated inspection payment. Escrow will be created upon successful payment.`,
      meta: { inspectionId },
    });

    notifyUser(inspection.user, "notification", {
      type: "inspection_payment_started",
      title: "Inspection Payment Initiated",
      message: `You started inspection payment.`,
      inspectionId,
      status: inspection.status,
    });

    const init = await initializeTransaction(
      req.user.email,
      Math.round(inspection.fee * 100),
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
// 3️⃣ Shared Payment Confirmation Logic
// ---------------------------
const processInspectionPaymentConfirmation = async (inspection, reference) => {
  const verification = await verifyTransaction(reference);
  if (!verification || verification.data.status !== "success") {
    throw new Error("Payment not successful or verification failed");
  }

  const expectedAmountInKobo = Math.round(inspection.fee * 100);
  if (verification.data.amount !== expectedAmountInKobo) {
    throw new Error(
      "Amount mismatch detected! Paid amount does not match inspection fee.",
    );
  }

  if (
    inspection.status === "inspection_payment_review" ||
    inspection.status === "inspection_paid" ||
    inspection.status === "inspection_confirmed" ||
    inspection.status === "inspection_completed"
  ) {
    return inspection; // Idempotent return
  }

  inspection.status = "inspection_payment_review";
  inspection.paystackPaidAt = new Date();
  await inspection.save();

  const agentId = inspection.owner?._id || inspection.owner;

  await Notification.create({
    user: inspection.user,
    title: "Inspection Payment Received",
    message: `Your payment is confirmed and currently under review by the admin.`,
    meta: { inspectionId: inspection._id },
  });

  if (agentId) {
    await Notification.create({
      user: agentId,
      title: "Inspection Payment Under Review",
      message: `Inspection payment for "${inspection.property?.title}" received and awaiting admin approval.`,
      meta: { inspectionId: inspection._id },
    });
  }

  const adminUsers = await User.find({ role: "admin" });
  for (const admin of adminUsers) {
    await Notification.create({
      user: admin._id,
      title: "Inspection Payment Review Required",
      message: `An inspection payment requires your review and approval.`,
      meta: { inspectionId: inspection._id },
    });
    notifyUser(admin._id, "notification", {
      type: "inspection_payment_review",
      title: "Inspection Payment Review",
      message: `Inspection payment waiting for approval.`,
      inspectionId: inspection._id,
      status: inspection.status,
    });
  }

  notifyBoth(inspection.user, agentId, "notification", {
    type: "inspection_payment_review",
    title: "Payment Under Review",
    message: `Inspection payment confirmed, awaiting admin approval.`,
    inspectionId: inspection._id,
    status: inspection.status,
  });

  return inspection;
};

// ---------------------------
// 4️⃣ Buyer Callback Confirmation Route: POST /api/inspection/confirm-payment
// ---------------------------
const confirmInspectionPaymentCallback = async (req, res) => {
  try {
    const { inspectionId } = req.body;
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

    if (!inspection.reference) {
      return res.status(400).json({
        success: false,
        message: "No payment reference found for this inspection.",
      });
    }

    try {
      await processInspectionPaymentConfirmation(
        inspection,
        inspection.reference,
      );
      return res.json({
        success: true,
        message: "Payment successfully confirmed and submitted for review.",
        inspection,
      });
    } catch (verifyErr) {
      return res.status(400).json({
        success: false,
        message: verifyErr.message || "Payment not completed.",
      });
    }
  } catch (err) {
    console.error("confirmInspectionPaymentCallback error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ---------------------------
// 5️⃣ Verify & Approve Inspection Payment (Admin Only)
// ---------------------------
const verifyInspectionPayment = async (req, res) => {
  try {
    const { inspectionId } = req.body;
    const adminId = req.user._id;

    if (!req.user || req.user.role !== "admin") {
      return res
        .status(403)
        .json({ success: false, message: "Access denied. Admin only." });
    }

    const inspection = await Inspection.findById(inspectionId)
      .populate("owner")
      .populate("property");

    if (!inspection) {
      return res
        .status(404)
        .json({ success: false, message: "Inspection not found" });
    }

    if (inspection.status !== "inspection_payment_review") {
      return res.status(400).json({
        success: false,
        message: "Inspection is not in payment review status.",
      });
    }

    const verification = await verifyTransaction(inspection.reference);
    if (!verification || verification.data.status !== "success") {
      return res.status(400).json({
        success: false,
        message: "Paystack verification failed. Payment was not successful.",
      });
    }

    let escrow = await Escrow.findOne({ reference: inspection.reference });
    if (!escrow) {
      escrow = await Escrow.create({
        property: inspection.property?._id,
        buyer: inspection.user,
        seller: inspection.owner?._id || inspection.owner,
        inspection: inspection._id,
        amount: inspection.fee,
        netPayout: inspection.fee,
        platformFee: 0,
        status: "on_hold",
        reference: inspection.reference,
        type: "inspection",
      });
    }

    inspection.feePaid = true;
    inspection.escrowHeldBy = adminId;
    inspection.status = "inspection_paid";
    inspection.paidAt = new Date();
    await inspection.save();

    const agentId = inspection.owner?._id || inspection.owner;

    await Notification.create({
      user: inspection.user,
      title: "Inspection Fee Paid & Approved",
      message: `Your inspection payment has been approved by admin. Waiting for the agent to schedule a date.`,
      meta: { inspectionId, escrowId: escrow._id },
    });

    if (agentId) {
      await Notification.create({
        user: agentId,
        title: "Inspection Fee Approved - Schedule Required",
        message: `Inspection fee for "${inspection.property?.title}" approved. Please schedule an inspection date.`,
        meta: { inspectionId, escrowId: escrow._id },
      });
    }

    notifyBoth(inspection.user, agentId, "notification", {
      type: "inspection_fee_paid",
      title: "Inspection Payment Approved",
      message: `Inspection fee approved and escrow created.`,
      inspectionId,
      escrowId: escrow._id,
      status: inspection.status,
    });

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
// 6️⃣ Paystack Webhook Handler (Public)
// ---------------------------
const handlePaystackWebhook = async (req, res) => {
  try {
    const secret = process.env.PAYSTACK_SECRET_KEY;
    const paystackSignature = req.headers["x-paystack-signature"];

    const hash = crypto
      .createHmac("sha512", secret)
      .update(JSON.stringify(req.body))
      .digest("hex");

    if (hash !== paystackSignature) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid signature" });
    }

    const event = req.body;
    if (event && event.event === "charge.success") {
      const data = event.data;
      const reference = data.reference;

      // Check Inspection
      const inspection = await Inspection.findOne({ reference }).populate(
        "property owner",
      );
      if (inspection) {
        const expectedAmountInKobo = Math.round(inspection.fee * 100);
        if (
          data.amount === expectedAmountInKobo &&
          inspection.status !== "inspection_paid"
        ) {
          await processInspectionPaymentConfirmation(inspection, reference);
        }
      }

      // Check Purchase
      const purchase = await Purchase.findOne({ reference }).populate(
        "property owner buyer",
      );
      if (purchase) {
        const expectedAmountInKobo = Math.round(purchase.price * 100);
        if (
          data.amount === expectedAmountInKobo &&
          purchase.status === "none"
        ) {
          purchase.status = "property_payment_review";
          purchase.paystackPaidAt = new Date();
          await purchase.save();

          notifyBoth(purchase.buyer, purchase.owner, "notification", {
            type: "property_payment_review",
            title: "Property Payment Under Review",
            message: `Property purchase payment confirmed via webhook, awaiting admin approval.`,
            purchaseId: purchase._id,
            status: purchase.status,
          });
        }
      }
    }

    res.status(200).json({ received: true });
  } catch (err) {
    console.error("handlePaystackWebhook error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ---------------------------
// 7️⃣ Schedule Inspection (Agent / Property Owner ONLY)
// ---------------------------
const scheduleInspection = async (req, res) => {
  try {
    const { inspectionId, scheduledDate } = req.body;
    const userId = req.user._id;

    const parsedDate = new Date(scheduledDate);
    if (
      !scheduledDate ||
      isNaN(parsedDate.getTime()) ||
      parsedDate <= new Date()
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Please provide a valid future date and time for the inspection.",
      });
    }

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
          "Unauthorized. Only property owner or agent can schedule an inspection.",
      });
    }

    if (!inspection.feePaid) {
      return res.status(400).json({
        success: false,
        message:
          "Cannot schedule date because the inspection fee has not been paid.",
      });
    }

    inspection.scheduledDate = parsedDate;
    inspection.status = "inspection_scheduled";
    inspection.scheduledAt = new Date();
    await inspection.save();

    await Notification.create({
      user: inspection.user,
      title: "Inspection Date Scheduled",
      message: `Your inspection for "${inspection.property?.title}" has been scheduled for ${parsedDate.toLocaleString()}.`,
      meta: { inspectionId },
    });

    notifyBoth(inspection.user, ownerId, "notification", {
      type: "inspection_scheduled",
      title: "Inspection Scheduled",
      message: `Inspection scheduled for ${parsedDate.toLocaleString()}.`,
      inspectionId,
      status: inspection.status,
    });

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
          "You can only request a reschedule for a scheduled inspection.",
      });
    }

    inspection.status = "inspection_paid";
    inspection.scheduledDate = null;
    inspection.scheduledAt = null;
    await inspection.save();

    const ownerId = inspection.owner?._id || inspection.owner;
    if (ownerId) {
      await Notification.create({
        user: ownerId,
        title: "Inspection Reschedule Requested",
        message: `Buyer rejected the scheduled date for "${inspection.property?.title}". Reason: ${reason || "Not suitable"}.`,
        meta: { inspectionId },
      });
    }

    notifyBoth(inspection.user, ownerId, "notification", {
      type: "inspection_reschedule_requested",
      title: "Inspection Reschedule Requested",
      message: `Buyer rejected the scheduled inspection date.`,
      inspectionId,
      status: inspection.status,
    });

    res.json({
      success: true,
      message: "Inspection date rejected. Agent has been notified.",
      inspection,
    });
  } catch (err) {
    console.error("rescheduleInspection error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

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

    if (inspection.user?.toString() !== userId.toString()) {
      return res
        .status(403)
        .json({ success: false, message: "Unauthorized buyer." });
    }

    if (inspection.status !== "inspection_scheduled") {
      return res.status(400).json({
        success: false,
        message: "Inspection must be scheduled before confirmation.",
      });
    }

    inspection.status = "inspection_confirmed";
    inspection.confirmedAt = new Date();
    await inspection.save();

    let escrow = await Escrow.findOne({ inspection: inspection._id });
    if (escrow) {
      escrow.status = "on_hold";
      await escrow.save();
    }

    const ownerId = inspection.owner?._id || inspection.owner;
    if (ownerId) {
      await Notification.create({
        user: ownerId,
        title: "Inspection Confirmed by Buyer",
        message: `Buyer has confirmed the inspection schedule for "${inspection.property?.title}".`,
        meta: { inspectionId },
      });
    }

    notifyBoth(inspection.user, ownerId, "notification", {
      type: "inspection_confirmed",
      title: "Inspection Confirmed",
      message: `Inspection confirmed by buyer.`,
      inspectionId,
      status: inspection.status,
    });

    res.json({
      success: true,
      message: "Inspection schedule confirmed successfully.",
      inspection,
    });
  } catch (err) {
    console.error("confirmInspection error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

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
        message: "Inspection must be confirmed before completion.",
      });
    }

    inspection.status = "inspection_completed";
    inspection.completedAt = new Date();
    await inspection.save();

    const ownerId = inspection.owner?._id || inspection.owner;
    const adminUser = await User.findOne({ role: "admin" });

    if (ownerId) {
      await Notification.create({
        user: ownerId,
        title: "Inspection Completed",
        message: `Inspection for "${inspection.property?.title}" marked as completed by buyer.`,
        meta: { inspectionId },
      });
    }

    if (adminUser) {
      await Notification.create({
        user: adminUser._id,
        title: "Inspection Completed - Review Escrow",
        message: `Inspection completed. Escrow can now be processed for release by admin.`,
        meta: { inspectionId },
      });
      notifyUser(adminUser._id, "notification", {
        type: "inspection_completed",
        title: "Inspection Completed",
        message: `Inspection completed for "${inspection.property?.title}".`,
        inspectionId,
        status: inspection.status,
      });
    }

    notifyBoth(inspection.user, ownerId, "notification", {
      type: "inspection_completed",
      title: "Inspection Completed",
      message: `Inspection marked as completed.`,
      inspectionId,
      status: inspection.status,
    });

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

const changeInspectionStatus = async (req, res) => {
  try {
    const { inspectionId } = req.params;
    const { status } = req.body;
    const adminId = req.user._id;

    if (!req.user || req.user.role !== "admin") {
      return res
        .status(403)
        .json({ success: false, message: "Admin access required." });
    }

    const allowedStatuses = [
      "none",
      "inspection_requested",
      "inspection_initialized",
      "inspection_payment_review",
      "inspection_paid",
      "inspection_scheduled",
      "inspection_confirmed",
      "inspection_completed",
      "inspection_cancelled",
    ];

    if (!allowedStatuses.includes(status)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid status provided." });
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

    let escrow = await Escrow.findOne({ inspection: inspection._id });
    if (escrow && status === "inspection_cancelled") {
      escrow.status = "refunded";
      escrow.releasedAt = new Date();
      escrow.releasedBy = adminId;
      if (req.body.reason) escrow.reason = req.body.reason;
      await escrow.save();
    }

    const ownerId = inspection.owner?._id || inspection.owner;
    notifyBoth(inspection.user, ownerId, "notification", {
      type: "inspection_status_changed",
      title: "Inspection Status Updated",
      message: `Inspection status changed to ${status}.`,
      inspectionId,
      status,
    });

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

const getInspectionDetails = async (req, res) => {
  try {
    const { inspectionId } = req.params;

    const inspection = await Inspection.findById(inspectionId)
      .populate("property", "title price address images")
      .populate("owner", "name email phoneNumber profilePicture")
      .populate("user", "name email phoneNumber profilePicture")
      .populate("escrowHeldBy", "name email phoneNumber profilePicture");

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

// getUserInspections remains UNFILTERED so unpaid requests can be resumed
const getUserInspections = async (req, res) => {
  try {
    const userId = req.user._id;

    const inspections = await Inspection.find({ user: userId })
      .populate("property", "title price address images")
      .populate("owner", "name email phoneNumber profilePicture")
      .populate("escrowHeldBy", "name email phoneNumber profilePicture")
      .sort({ createdAt: -1 });

    const formattedInspections = inspections.map((inspection) => {
      const inspectionObj = inspection.toObject();
      if (inspectionObj.property) {
        inspectionObj.property.image =
          inspectionObj.property.images &&
          inspectionObj.property.images.length > 0
            ? inspectionObj.property.images[0]
            : null;
      }
      return inspectionObj;
    });

    res.json({ success: true, inspections: formattedInspections });
  } catch (err) {
    console.error("getUserInspections error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// Hides draft/unpaid statuses from agent list
const getAgentInspections = async (req, res) => {
  try {
    const agentId = req.user._id;

    const inspections = await Inspection.find({
      owner: agentId,
      status: {
        $nin: ["none", "inspection_requested", "inspection_initialized"],
      },
    })
      .populate("property", "title price address images")
      .populate("user", "name email phoneNumber profilePicture")
      .populate("owner", "name email phoneNumber profilePicture")
      .populate("escrowHeldBy", "name email phoneNumber profilePicture")
      .sort({ createdAt: -1 });

    const formattedInspections = inspections.map((inspection) => {
      const inspectionObj = inspection.toObject();
      if (
        inspectionObj.property &&
        Array.isArray(inspectionObj.property.images)
      ) {
        inspectionObj.property.firstImage =
          inspectionObj.property.images[0] || null;
      }
      return inspectionObj;
    });

    res.json({ success: true, inspections: formattedInspections });
  } catch (err) {
    console.error("getAgentInspections error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// Hides draft/unpaid statuses from admin list
const getAllInspections = async (req, res) => {
  try {
    const inspections = await Inspection.find({
      status: {
        $nin: ["none", "inspection_requested", "inspection_initialized"],
      },
    })
      .populate("property", "title price address images")
      .populate("user", "name email phoneNumber profilePicture")
      .populate("owner", "name email phoneNumber profilePicture")
      .populate("escrowHeldBy", "name email phoneNumber profilePicture")
      .sort({ createdAt: -1 });

    const formattedInspections = inspections.map((inspection) => {
      const inspectionObj = inspection.toObject();
      if (inspectionObj.property) {
        inspectionObj.property.image =
          inspectionObj.property.images &&
          inspectionObj.property.images.length > 0
            ? inspectionObj.property.images[0]
            : null;
      }
      return inspectionObj;
    });

    res.json({ success: true, inspections: formattedInspections });
  } catch (err) {
    console.error("getAllInspections error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = {
  requestInspection,
  initializeInspectionPayment,
  confirmInspectionPaymentCallback,
  verifyInspectionPayment,
  handlePaystackWebhook,
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
