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
const { processPurchasePaymentConfirmation } = require("./purchase");
const { recordWalletFunding } = require("./transaction");
const { calculateRefundFee } = require("../middlewares/platformFee");

// Helper for targeted socket notifications with error isolation
const notifyUser = (userId, event, data) => {
  try {
    if (global.io && userId) {
      global.io.to(userId.toString()).emit(event, data);
    }
  } catch (err) {
    console.error("Socket notification error:", err);
  }
};

const notifyBoth = (buyerId, agentId, event, data) => {
  notifyUser(buyerId, event, data);
  if (agentId) notifyUser(agentId, event, data);
};

// ---------------------------
// 1️⃣ Request Inspection (Allows resume if unpaid, ignores cancelled)
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

    // A cancelled inspection whose money hasn't been sent back yet blocks a
    // new request. The admin clears refundDue with "mark refund sent".
    const refundPending = await Inspection.findOne({
      property: propertyId,
      user: userId,
      status: "inspection_cancelled",
      refundDue: true,
    });
    if (refundPending) {
      return res.status(400).json({
        success: false,
        message:
          "Your refund for the cancelled inspection is still being processed. You can request a new inspection once it has been sent.",
        inspectionId: refundPending._id,
        status: refundPending.status,
      });
    }

    // Ignore cancelled inspection records when checking for existing ones
    const existingInspection = await Inspection.findOne({
      property: propertyId,
      user: userId,
      status: { $ne: "inspection_cancelled" },
    });

    if (existingInspection) {
      if (
        !existingInspection.feePaid &&
        existingInspection.status !== "inspection_payment_review"
      ) {
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

    if (
      inspection.feePaid ||
      [
        "inspection_payment_review",
        "inspection_paid",
        "inspection_scheduled",
        "inspection_confirmed",
        "inspection_completed",
      ].includes(inspection.status)
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Inspection fee has already been paid or is currently under review.",
      });
    }

    // If reference already exists, check if old payment actually went through first
    if (inspection.reference) {
      try {
        const prevVerification = await verifyTransaction(inspection.reference);
        if (prevVerification && prevVerification.data.status === "success") {
          await processInspectionPaymentConfirmation(
            inspection,
            inspection.reference,
          );
          return res.status(409).json({
            success: false,
            message:
              "Payment was already received for this inspection. Status updated to review.",
            inspectionId: inspection._id,
            status: inspection.status,
          });
        }
      } catch (e) {
        // Ignore verification error on old ref and allow generating a fresh one
      }
    }

    const reference = crypto.randomBytes(16).toString("hex");

    // Initialize transaction with Paystack first before committing state changes
    const init = await initializeTransaction(
      req.user.email,
      Math.round(inspection.fee * 100),
      reference,
      callback_url,
    );

    if (!init || !init.status || !init.data?.authorization_url) {
      return res.status(400).json({
        success: false,
        message: "Failed to initialize Paystack transaction.",
      });
    }

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
// 3️⃣ Shared Payment Confirmation Logic (Idempotent & Resilient)
// ---------------------------
const processInspectionPaymentConfirmation = async (inspection, reference) => {
  let verification;
  try {
    verification = await verifyTransaction(reference);
  } catch (netErr) {
    console.error("Paystack network error during confirmation:", netErr);
    return { success: true, status: "processing" };
  }

  if (!verification || verification.data.status !== "success") {
    throw new Error("Payment not successful or verification failed");
  }

  const expectedAmountInKobo = Math.round(inspection.fee * 100);
  const paidAmount = verification.data.amount;
  let amountMismatch = false;

  if (paidAmount !== expectedAmountInKobo) {
    amountMismatch = true;
  }

  // Idempotency: if already past initialized/requested, return current record
  if (
    inspection.status === "inspection_payment_review" ||
    inspection.status === "inspection_paid" ||
    inspection.status === "inspection_confirmed" ||
    inspection.status === "inspection_completed"
  ) {
    return inspection;
  }

  // Atomic state transition
  const updated = await Inspection.findOneAndUpdate(
    {
      _id: inspection._id,
      status: { $in: ["inspection_requested", "inspection_initialized"] },
    },
    {
      $set: {
        status: "inspection_payment_review",
        paystackPaidAt: new Date(),
        amountMismatch,
        paidAmount: paidAmount / 100,
      },
    },
    { new: true },
  );

  if (!updated) {
    // Already updated concurrently
    return await Inspection.findById(inspection._id);
  }

  const agentId = inspection.owner?._id || inspection.owner;

  await Notification.create({
    user: inspection.user,
    title: "Inspection Payment Received",
    message: amountMismatch
      ? `Your payment was received, but an amount mismatch was detected. It is under admin review.`
      : `Your payment is confirmed and currently under review by the admin.`,
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
      message: amountMismatch
        ? `Inspection payment amount mismatch detected!`
        : `An inspection payment requires your review and approval.`,
      meta: { inspectionId: inspection._id },
    });
    notifyUser(admin._id, "notification", {
      type: "inspection_payment_review",
      title: "Inspection Payment Review",
      message: `Inspection payment waiting for approval.`,
      inspectionId: inspection._id,
      status: updated.status,
      amountMismatch,
    });
  }

  notifyBoth(inspection.user, agentId, "notification", {
    type: "inspection_payment_review",
    title: "Payment Under Review",
    message: `Inspection payment confirmed, awaiting admin approval.`,
    inspectionId: inspection._id,
    status: updated.status,
  });

  return updated;
};

// ---------------------------
// 4️⃣ Buyer Callback Confirmation Route: POST /api/inspection/confirm-payment
// ---------------------------
const confirmInspectionPaymentCallback = async (req, res) => {
  try {
    const { inspectionId, reference } = req.body;
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

    const payRef = reference || inspection.reference;
    if (!payRef) {
      return res.status(400).json({
        success: false,
        message: "No payment reference found for this inspection.",
      });
    }

    try {
      const result = await processInspectionPaymentConfirmation(
        inspection,
        payRef,
      );
      return res.json({
        success: true,
        status: result.status || "inspection_payment_review",
        message: "Payment successfully confirmed and submitted for review.",
        inspection: result,
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

    const expectedAmountInKobo = Math.round(inspection.fee * 100);
    const amountMismatch = verification.data.amount !== expectedAmountInKobo;

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
    inspection.amountMismatch = amountMismatch;
    if (amountMismatch) inspection.paidAmount = verification.data.amount / 100;
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
      amountMismatch,
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
// 2️⃣.1 Reject Payment Under Review (Admin Only - New)
// ---------------------------
const rejectInspectionPayment = async (req, res) => {
  try {
    const { id, reason } = req.body;
    if (!req.user || req.user.role !== "admin") {
      return res.status(403).json({ success: false, message: "Admin only." });
    }

    const inspection = await Inspection.findById(id).populate("property");
    if (!inspection)
      return res
        .status(404)
        .json({ success: false, message: "Inspection not found" });

    if (inspection.status !== "inspection_payment_review") {
      return res.status(400).json({
        success: false,
        message: "Inspection is not under payment review.",
      });
    }

    const claimed = await Inspection.findOneAndUpdate(
      { _id: id, status: "inspection_payment_review" },
      {
        $set: {
          status: "inspection_cancelled",
          refundDue: true,
          refundAmount: inspection.paidAmount || inspection.fee,
        },
      },
      { new: true },
    );
    if (!claimed) {
      return res.status(400).json({
        success: false,
        message: "Inspection is no longer under payment review.",
      });
    }
    inspection.status = claimed.status;
    inspection.refundDue = claimed.refundDue;
    inspection.refundAmount = claimed.refundAmount;

    const agentId = inspection.owner?._id || inspection.owner;

    await Notification.create({
      user: inspection.user,
      title: "Inspection Payment Rejected",
      message: `Your payment was rejected. Reason: ${reason || "Admin review failed"}. Your refund will be sent to your original payment method.`,
      meta: { inspectionId: inspection._id },
    });

    notifyBoth(inspection.user, agentId, "notification", {
      type: "inspection_cancelled",
      title: "Inspection Payment Rejected",
      message: `Inspection payment was rejected by admin.`,
      inspectionId: inspection._id,
      status: inspection.status,
    });

    res.json({
      success: true,
      message: "Inspection payment rejected and marked for refund.",
      inspection,
    });
  } catch (err) {
    console.error("rejectInspectionPayment error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ---------------------------
// 2️⃣.2 Mark Refund Sent (Admin Only - New)
// ---------------------------
const markInspectionRefundSent = async (req, res) => {
  try {
    const { id, amountSent, transferReference, note, waiveProcessingFee } =
      req.body;
    if (!req.user || req.user.role !== "admin") {
      return res.status(403).json({ success: false, message: "Admin only." });
    }

    const inspection = await Inspection.findById(id);
    if (!inspection)
      return res
        .status(404)
        .json({ success: false, message: "Inspection not found" });
    // the buyer's refund processing fee, unless the admin waived it
    const amountPaid =
      inspection.refundAmount || inspection.paidAmount || inspection.fee;
    const fee =
      waiveProcessingFee === true || waiveProcessingFee === "true"
        ? 0
        : calculateRefundFee(amountPaid);

    const claimed = await Inspection.findOneAndUpdate(
      { _id: id, refundDue: true },
      {
        $set: {
          refundDue: false,
          refundSentAt: new Date(),
          // refundSentAmount: Number(amountSent) || inspection.refundAmount,
          refundSentAmount: Number(amountSent) || amountPaid - fee,
          refundProcessingFee: fee,
          refundReference: transferReference,
          refundNote: note,
        },
      },
      { new: true },
    );
    if (!claimed) {
      return res.status(400).json({
        success: false,
        message: "No pending refund due for this inspection.",
      });
    }
    inspection.refundSentAmount = claimed.refundSentAmount;

    await Notification.create({
      user: inspection.user,
      title: "Inspection Refund Sent",
      // message: `Your offline refund of ${inspection.refundSentAmount} has been sent. Reference: ${transferReference || "N/A"}`,
      message: `Your refund of ₦${Number(inspection.refundSentAmount).toLocaleString()} has been sent${fee ? ` (a ₦${fee.toLocaleString()} processing fee was deducted)` : ""}. Reference: ${transferReference || "N/A"}`,
      meta: { inspectionId: inspection._id },
    });

    notifyUser(inspection.user, "notification", {
      type: "inspection_refund_sent",
      title: "Refund Sent",
      message: `Inspection refund has been marked as sent by admin.`,
      inspectionId: inspection._id,
    });

    res.json({
      success: true,
      message: "Inspection refund marked as sent successfully.",
      inspection,
    });
  } catch (err) {
    console.error("markInspectionRefundSent error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ---------------------------
// 6️⃣ Paystack Webhook Handler (Public) - Uses PAYSTACK_SECRET
// ---------------------------
const handlePaystackWebhook = async (req, res) => {
  try {
    const secret = process.env.PAYSTACK_SECRET;
    const paystackSignature = req.headers["x-paystack-signature"];

    // Use rawBody captured via express.json verify middleware if available
    const rawBodyPayload = req.rawBody ? req.rawBody : JSON.stringify(req.body);

    const hash = crypto
      .createHmac("sha512", secret)
      .update(rawBodyPayload)
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
        if (inspection.status !== "inspection_paid") {
          await processInspectionPaymentConfirmation(inspection, reference);
        }
      }
      const purchase = await Purchase.findOne({ reference }).populate(
        "property owner",
      );
      if (purchase) {
        await processPurchasePaymentConfirmation(purchase, reference);
      }

      if (data.metadata?.purpose === "wallet_funding") {
        await recordWalletFunding(reference, data); // see section 6
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

    // Money steps have their own endpoints (see changePurchaseStatus)
    const allowedStatuses = [
      "inspection_scheduled",
      "inspection_confirmed",
      "inspection_completed",
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
    if (status === "inspection_cancelled") {
      inspection.refundDue = true;
    }
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
      .populate(
        "property",
        "title price escrowFee serviceCharge listingType address images",
      )
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
      .populate(
        "property",
        "title price escrowFee serviceCharge listingType address images",
      )
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
      .populate(
        "property",
        "title price escrowFee serviceCharge listingType address images",
      )
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

// Hides draft/unpaid statuses from admin list, includes refundDue tracking
const getAllInspections = async (req, res) => {
  try {
    const inspections = await Inspection.find({
      status: {
        $nin: ["none", "inspection_requested", "inspection_initialized"],
      },
    })
      .populate(
        "property",
        "title price escrowFee serviceCharge listingType address images",
      )
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
  rejectInspectionPayment,
  markInspectionRefundSent,
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
