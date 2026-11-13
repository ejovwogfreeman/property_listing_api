const Purchase = require("../models/purchase");
const Property = require("../models/property");
const Inspection = require("../models/inspection");
const User = require("../models/user");
const Escrow = require("../models/escrow");
const Notification = require("../models/notification");
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
// 1️⃣ Request Purchase
// ---------------------------
const requestPurchase = async (req, res) => {
  try {
    const { propertyId } = req.body;
    const userId = req.user._id;

    const property = await Property.findById(propertyId);
    if (!property)
      return res
        .status(404)
        .json({ success: false, message: "Property not found" });

    const inspection = await Inspection.findOne({
      property: propertyId,
      user: userId,
      status: "inspection_completed",
      feePaid: true,
    });
    if (!inspection)
      return res.status(400).json({
        success: false,
        message: "You must complete and pay for inspection first",
      });

    const existingPurchase = await Purchase.findOne({
      property: propertyId,
      buyer: userId,
    });

    if (existingPurchase) {
      if (!existingPurchase.feePaid) {
        return res.status(200).json({
          success: true,
          resumed: true,
          message:
            "Unpaid purchase request found. You can resume payment with this ID.",
          purchaseId: existingPurchase._id,
          status: existingPurchase.status,
        });
      }

      return res.status(400).json({
        success: false,
        message:
          "An active or completed purchase for this property already exists.",
        purchaseId: existingPurchase._id,
        status: existingPurchase.status,
      });
    }

    const totalPrice =
      property.price +
      (property.escrowFee || 0) +
      (property.serviceCharge || 0);

    const platformFee = property.escrowFee || 0;

    const purchase = await Purchase.create({
      property: property._id,
      buyer: userId,
      owner: property.owner,
      inspection: inspection._id,
      price: totalPrice,
      platformFee: platformFee,
      status: "none",
    });

    await Notification.create({
      user: userId,
      title: "Purchase Requested",
      message: `Purchase requested for "${property.title}".`,
      meta: { purchaseId: purchase._id },
    });

    notifyUser(userId, "notification", {
      type: "purchase_requested",
      title: "Purchase Requested",
      message: `Purchase requested for "${property.title}".`,
      purchaseId: purchase._id,
      status: purchase.status,
    });

    res.status(201).json({
      success: true,
      resumed: false,
      message: "Purchase initiated successfully. Proceed to payment.",
      purchaseId: purchase._id,
    });
  } catch (err) {
    console.error("requestPurchase error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ---------------------------
// 2️⃣ Initialize Purchase Payment (Paystack)
// ---------------------------
const initializePurchasePayment = async (req, res) => {
  try {
    const { purchaseId, callback_url } = req.body;
    const buyerId = req.user._id;

    const purchase = await Purchase.findById(purchaseId).populate("owner");
    if (!purchase)
      return res.status(404).json({ message: "Purchase not found" });

    if (purchase.buyer.toString() !== buyerId.toString())
      return res.status(403).json({ message: "Unauthorized" });

    if (purchase.feePaid)
      return res.status(400).json({ message: "Purchase already paid" });

    const reference = crypto.randomBytes(16).toString("hex");
    purchase.reference = reference;
    purchase.initializedAt = new Date();
    await purchase.save();

    const init = await initializeTransaction(
      req.user.email,
      Math.round(purchase.price * 100),
      reference,
      callback_url,
    );

    await Notification.create({
      user: buyerId,
      title: "Purchase Payment Initiated",
      message: `Your payment for purchase is initializing. Escrow will be created upon successful verification.`,
      meta: { purchaseId },
    });

    notifyUser(buyerId, "notification", {
      type: "purchase_payment_initialized",
      title: "Purchase Payment Started",
      message: "A new purchase transaction has begun.",
      purchaseId,
      status: purchase.status,
    });

    res.json({
      success: true,
      message: "Purchase payment initialized",
      authorizationUrl: init.data.authorization_url,
      reference,
      purchaseId: purchase._id,
      callback_url,
    });
  } catch (err) {
    console.error("initializePurchasePayment error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ---------------------------
// 3️⃣ Shared Payment Confirmation Logic
// ---------------------------
const processPurchasePaymentConfirmation = async (purchase, reference) => {
  const verification = await verifyTransaction(reference);
  if (!verification || verification.data.status !== "success") {
    throw new Error("Payment not successful or verification failed");
  }

  const expectedAmountInKobo = Math.round(purchase.price * 100);
  if (verification.data.amount !== expectedAmountInKobo) {
    throw new Error(
      "Amount mismatch detected! Paid amount does not match property price.",
    );
  }

  if (
    purchase.status === "property_payment_review" ||
    purchase.status === "property_payment_made" ||
    purchase.status === "completed"
  ) {
    return purchase;
  }

  purchase.status = "property_payment_review";
  purchase.paystackPaidAt = new Date();
  await purchase.save();

  const sellerId = purchase.owner?._id || purchase.owner;

  await Notification.create({
    user: purchase.buyer,
    title: "Purchase Payment Received",
    message: `Your purchase payment is confirmed and currently under review by the admin.`,
    meta: { purchaseId: purchase._id },
  });

  if (sellerId) {
    await Notification.create({
      user: sellerId,
      title: "Purchase Payment Under Review",
      message: `Purchase payment received and awaiting admin approval.`,
      meta: { purchaseId: purchase._id },
    });
  }

  const adminUsers = await User.find({ role: "admin" });
  for (const admin of adminUsers) {
    await Notification.create({
      user: admin._id,
      title: "Purchase Payment Review Required",
      message: `A purchase payment requires your review and approval.`,
      meta: { purchaseId: purchase._id },
    });
    notifyUser(admin._id, "notification", {
      type: "property_payment_review",
      title: "Purchase Payment Review",
      message: `Purchase payment waiting for approval.`,
      purchaseId: purchase._id,
      status: purchase.status,
    });
  }

  notifyBoth(purchase.buyer, sellerId, "notification", {
    type: "property_payment_review",
    title: "Payment Under Review",
    message: `Purchase payment confirmed, awaiting admin approval.`,
    purchaseId: purchase._id,
    status: purchase.status,
  });

  return purchase;
};

// ---------------------------
// 4️⃣ Buyer Callback Confirmation Route: POST /api/purchase/confirm-payment
// ---------------------------
const confirmPurchasePaymentCallback = async (req, res) => {
  try {
    const { purchaseId } = req.body;
    const userId = req.user._id;

    const purchase = await Purchase.findById(purchaseId).populate("property");
    if (!purchase) {
      return res
        .status(404)
        .json({ success: false, message: "Purchase not found" });
    }

    if (purchase.buyer?.toString() !== userId.toString()) {
      return res.status(403).json({ success: false, message: "Unauthorized" });
    }

    if (!purchase.reference) {
      return res.status(400).json({
        success: false,
        message: "No payment reference found for this purchase.",
      });
    }

    try {
      await processPurchasePaymentConfirmation(purchase, purchase.reference);
      return res.json({
        success: true,
        message: "Payment successfully confirmed and submitted for review.",
        purchase,
      });
    } catch (verifyErr) {
      return res.status(400).json({
        success: false,
        message: verifyErr.message || "Payment not completed.",
      });
    }
  } catch (err) {
    console.error("confirmPurchasePaymentCallback error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ---------------------------
// 5️⃣ Verify & Approve Purchase Payment (Admin Only)
// ---------------------------
const verifyPurchasePayment = async (req, res) => {
  try {
    const { purchaseId } = req.body;
    const adminId = req.user._id;

    if (!req.user || req.user.role !== "admin") {
      return res
        .status(403)
        .json({ success: false, message: "Access denied. Admin only." });
    }

    const purchase = await Purchase.findById(purchaseId).populate("owner");
    if (!purchase)
      return res
        .status(404)
        .json({ success: false, message: "Purchase not found" });

    if (purchase.status !== "property_payment_review") {
      return res.status(400).json({
        success: false,
        message: "Purchase is not in property payment review status.",
      });
    }

    const verification = await verifyTransaction(purchase.reference);
    if (!verification || verification.data.status !== "success")
      return res.status(400).json({
        success: false,
        message: "Paystack verification failed. Payment was not successful.",
      });

    const platformFee = purchase.platformFee || 0;
    const netPayout = purchase.price - platformFee;

    let escrow = await Escrow.findOne({ reference: purchase.reference });
    if (!escrow) {
      escrow = await Escrow.create({
        reference: purchase.reference,
        property: purchase.property,
        buyer: purchase.buyer,
        seller: purchase.owner._id || purchase.owner,
        purchase: purchase._id,
        amount: purchase.price,
        netPayout: netPayout,
        platformFee: platformFee,
        status: "on_hold",
        type: "purchase",
      });
    }

    purchase.feePaid = true;
    purchase.escrowHeldBy = adminId;
    purchase.status = "property_payment_made";
    purchase.paidAt = new Date();
    await purchase.save();

    const sellerId = purchase.owner?._id || purchase.owner;

    await Notification.create({
      user: purchase.buyer,
      title: "Purchase Payment Approved",
      message: `Your purchase payment has been approved by admin and escrow created.`,
      meta: { purchaseId, escrowId: escrow._id },
    });

    if (sellerId) {
      await Notification.create({
        user: sellerId,
        title: "Purchase Payment Approved & Held in Escrow",
        message: `Payment for your property is approved and held in escrow.`,
        meta: { purchaseId, escrowId: escrow._id },
      });
    }

    notifyBoth(purchase.buyer, sellerId, "notification", {
      type: "purchase_payment_verified",
      title: "Purchase Payment Approved",
      message: "Purchase payment approved and escrow created.",
      purchaseId,
      escrowId: escrow._id,
      status: purchase.status,
    });

    res.json({
      success: true,
      message: "Payment verified successfully. Escrow created as pending.",
      purchase,
      escrow,
    });
  } catch (err) {
    console.error("verifyPurchasePayment error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ---------------------------
// 6️⃣ Schedule Handover (Agent / Property Owner ONLY)
// ---------------------------
const schedulePurchaseHandover = async (req, res) => {
  try {
    const { purchaseId, scheduledDate } = req.body;
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
          "Please provide a valid future date and time for the handover.",
      });
    }

    const purchase = await Purchase.findById(purchaseId).populate("property");
    if (!purchase) {
      return res
        .status(404)
        .json({ success: false, message: "Purchase not found" });
    }

    const ownerId = purchase.owner?._id || purchase.owner;
    const isOwner = ownerId && ownerId.toString() === userId.toString();
    const isAgent =
      purchase.property?.agent &&
      purchase.property.agent.toString() === userId.toString();

    if (!isOwner && !isAgent && req.user.role !== "admin") {
      return res.status(403).json({
        success: false,
        message:
          "Unauthorized. Only property owner or agent can schedule a handover.",
      });
    }

    if (!purchase.feePaid) {
      return res.status(400).json({
        success: false,
        message:
          "Cannot schedule handover because purchase payment has not been made.",
      });
    }

    purchase.scheduledDate = parsedDate;
    purchase.status = "handover_scheduled";
    purchase.scheduledAt = new Date();
    await purchase.save();

    await Notification.create({
      user: purchase.buyer,
      title: "Handover Date Scheduled",
      message: `Handover scheduled for "${purchase.property?.title}" on ${parsedDate.toLocaleString()}.`,
      meta: { purchaseId },
    });

    notifyBoth(purchase.buyer, ownerId, "notification", {
      type: "handover_scheduled",
      title: "Handover Scheduled",
      message: `Handover scheduled for ${parsedDate.toLocaleString()}.`,
      purchaseId,
      status: purchase.status,
    });

    res.json({
      success: true,
      message: "Handover scheduled successfully. Buyer notified.",
      purchase,
    });
  } catch (err) {
    console.error("scheduleHandover error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ---------------------------
// 7️⃣ Reschedule / Reject Handover Date (User / Buyer)
// ---------------------------
const reschedulePurchaseHandover = async (req, res) => {
  try {
    const { purchaseId, reason } = req.body;
    const userId = req.user._id;

    const purchase = await Purchase.findById(purchaseId).populate("property");
    if (!purchase) {
      return res
        .status(404)
        .json({ success: false, message: "Purchase not found" });
    }

    if (purchase.buyer?.toString() !== userId.toString()) {
      return res.status(403).json({ success: false, message: "Unauthorized" });
    }

    if (purchase.status !== "handover_scheduled") {
      return res.status(400).json({
        success: false,
        message: "You can only request a reschedule for a scheduled handover.",
      });
    }

    purchase.status = "handover_rescheduled";
    purchase.scheduledDate = null;
    purchase.scheduledAt = null;
    await purchase.save();

    const sellerId = purchase.owner?._id || purchase.owner;
    if (sellerId) {
      await Notification.create({
        user: sellerId,
        title: "Handover Date Rejected / Reschedule Requested",
        message: `Buyer rejected the scheduled handover date for "${purchase.property?.title}". Reason: ${reason || "Not suitable"}.`,
        meta: { purchaseId },
      });
    }

    notifyBoth(purchase.buyer, sellerId, "notification", {
      type: "handover_reschedule_requested",
      title: "Handover Reschedule Requested",
      message: `Buyer rejected the handover date.`,
      purchaseId,
      status: purchase.status,
    });

    res.json({
      success: true,
      message: "Handover date rejected. Agent has been notified.",
      purchase,
    });
  } catch (err) {
    console.error("rescheduleHandover error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ---------------------------
// 8️⃣ Confirm / Accept Handover (User / Buyer ONLY)
// ---------------------------
const confirmPurchaseHandover = async (req, res) => {
  try {
    const { purchaseId } = req.params;
    const userId = req.user._id;

    const purchase = await Purchase.findById(purchaseId).populate("property");
    if (!purchase) {
      return res
        .status(404)
        .json({ success: false, message: "Purchase not found" });
    }

    if (purchase.buyer?.toString() !== userId.toString()) {
      return res
        .status(403)
        .json({ success: false, message: "Unauthorized buyer." });
    }

    if (purchase.status !== "handover_scheduled") {
      return res.status(400).json({
        success: false,
        message: "Handover must be scheduled before confirmation.",
      });
    }

    purchase.status = "handover_confirmed";
    purchase.confirmedAt = new Date();
    await purchase.save();

    let escrow = await Escrow.findOne({ purchase: purchase._id });
    if (escrow) {
      escrow.status = "on_hold";
      await escrow.save();
    }

    const sellerId = purchase.owner?._id || purchase.owner;
    if (sellerId) {
      await Notification.create({
        user: sellerId,
        title: "Handover Confirmed by Buyer",
        message: `Buyer has confirmed the handover schedule for "${purchase.property?.title}".`,
        meta: { purchaseId },
      });
    }

    notifyBoth(purchase.buyer, sellerId, "notification", {
      type: "handover_confirmed",
      title: "Handover Confirmed",
      message: `Handover confirmed by buyer.`,
      purchaseId,
      status: purchase.status,
    });

    res.json({
      success: true,
      message: "Handover schedule confirmed successfully.",
      purchase,
    });
  } catch (err) {
    console.error("confirmHandover error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ---------------------------
// 9️⃣ Mark Handover Completed (User / Buyer)
// ---------------------------
const completePurchaseHandover = async (req, res) => {
  try {
    const { purchaseId } = req.params;
    const userId = req.user._id;

    const purchase = await Purchase.findById(purchaseId).populate("property");
    if (!purchase) {
      return res
        .status(404)
        .json({ success: false, message: "Purchase not found" });
    }

    if (purchase.buyer?.toString() !== userId.toString()) {
      return res.status(403).json({ success: false, message: "Unauthorized" });
    }

    if (purchase.status !== "handover_confirmed") {
      return res.status(400).json({
        success: false,
        message: "Handover must be confirmed before completion.",
      });
    }

    purchase.status = "handover_completed";
    purchase.completedAt = new Date();
    await purchase.save();

    const sellerId = purchase.owner?._id || purchase.owner;
    const adminUser = await User.findOne({ role: "admin" });

    if (sellerId) {
      await Notification.create({
        user: sellerId,
        title: "Handover Completed",
        message: `Handover for "${purchase.property?.title}" marked as completed by buyer.`,
        meta: { purchaseId },
      });
    }

    if (adminUser) {
      await Notification.create({
        user: adminUser._id,
        title: "Handover Completed - Review Escrow",
        message: `Handover completed. Escrow can now be processed for release by admin.`,
        meta: { purchaseId },
      });
      notifyUser(adminUser._id, "notification", {
        type: "handover_completed",
        title: "Handover Completed",
        message: `Handover completed for "${purchase.property?.title}".`,
        purchaseId,
        status: purchase.status,
      });
    }

    notifyBoth(purchase.buyer, sellerId, "notification", {
      type: "handover_completed",
      title: "Handover Completed",
      message: `Handover marked as completed.`,
      purchaseId,
      status: purchase.status,
    });

    res.json({
      success: true,
      message: "Handover marked as completed successfully.",
      purchase,
    });
  } catch (err) {
    console.error("completeHandover error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ---------------------------
// 🔄 Change Purchase Status (Admin / Authorized Flow)
// ---------------------------
const changePurchaseStatus = async (req, res) => {
  try {
    const { purchaseId } = req.params;
    const { status } = req.body;

    if (!req.user || req.user.role !== "admin") {
      return res
        .status(403)
        .json({ success: false, message: "Admin access required." });
    }

    const allowedStatuses = [
      "none",
      "property_payment_review",
      "property_payment_made",
      "handover_requested",
      "handover_scheduled",
      "handover_rescheduled",
      "handover_confirmed",
      "handover_completed",
      "funds_released",
      "purchase_cancelled",
    ];

    if (!allowedStatuses.includes(status)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid status provided." });
    }

    const purchase = await Purchase.findById(purchaseId).populate("owner");
    if (!purchase) {
      return res
        .status(404)
        .json({ success: false, message: "Purchase not found" });
    }

    purchase.status = status;

    if (status === "property_payment_made" && !purchase.paidAt) {
      purchase.paidAt = new Date();
    } else if (
      status === "handover_scheduled" ||
      status === "handover_rescheduled"
    ) {
      purchase.scheduledAt = new Date();
    } else if (status === "handover_confirmed") {
      purchase.confirmedAt = new Date();
    } else if (status === "handover_completed") {
      purchase.completedAt = new Date();
    }

    const escrow = await Escrow.findOne({ purchase: purchase._id });

    if (status === "funds_released") {
      purchase.feeReleased = true;
      purchase.completedAt = purchase.completedAt || new Date();

      if (escrow) {
        escrow.status = "released";
        escrow.releasedAt = new Date();
        escrow.releasedBy = req.user._id;
        if (req.body.reason) escrow.reason = req.body.reason;
        await escrow.save();
      }
    } else if (status === "purchase_cancelled") {
      if (escrow) {
        escrow.status = "refunded";
        escrow.releasedAt = new Date();
        escrow.releasedBy = req.user._id;
        if (req.body.reason) escrow.reason = req.body.reason;
        await escrow.save();
      }
    }

    await purchase.save();

    const notificationMessage = `Your purchase status has been updated to: ${status.replace(/_/g, " ")}.`;

    await Notification.create({
      user: purchase.buyer,
      title: "Purchase Status Updated",
      message: notificationMessage,
      meta: { purchaseId, status },
    });

    const sellerId = purchase.owner?._id || purchase.owner;
    if (sellerId) {
      await Notification.create({
        user: sellerId,
        title: "Property Purchase Status Updated",
        message: `The purchase status for your property has changed to: ${status.replace(/_/g, " ")}.`,
        meta: { purchaseId, status },
      });
    }

    notifyBoth(purchase.buyer, sellerId, "notification", {
      type: "purchase_status_changed",
      title: "Purchase Status Updated",
      message: notificationMessage,
      purchaseId,
      status,
    });

    res.json({
      success: true,
      message: `Purchase status successfully updated to ${status}`,
      purchase,
    });
  } catch (err) {
    console.error("changePurchaseStatus error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ---------------------------
// 🔟 Get Purchase Details
// ---------------------------
const getPurchaseDetails = async (req, res) => {
  try {
    const { purchaseId } = req.params;

    const purchase = await Purchase.findById(purchaseId)
      .populate(
        "property",
        "title price escrowFee serviceCharge address images",
      )
      .populate("buyer", "name email phoneNumber profilePicture")
      .populate("owner", "name email phoneNumber profilePicture")
      .populate("escrowHeldBy", "name email phoneNumber profilePicture");

    if (!purchase)
      return res.status(404).json({ message: "Purchase not found" });

    res.json({ success: true, purchase });
  } catch (err) {
    console.error("getPurchaseDetails error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// getUserPurchases remains UNFILTERED so unpaid requests can be resumed
const getUserPurchases = async (req, res) => {
  try {
    const userId = req.params.id || req.user._id;

    const purchases = await Purchase.find({ buyer: userId })
      .populate(
        "property",
        "title price escrowFee serviceCharge address images",
      )
      .populate("owner", "name email phoneNumber profilePicture")
      .populate("escrowHeldBy", "name email phoneNumber profilePicture")
      .sort({ createdAt: -1 });

    res.json({ success: true, purchases });
  } catch (err) {
    console.error("getUserPurchases error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// Hides draft/unpaid statuses from agent list
const getAgentPurchases = async (req, res) => {
  try {
    const agentId = req.params.id || req.user._id;

    const properties = await Property.find(
      { agent: agentId },
      "_id title price address",
    );
    const propertyIds = properties.map((p) => p._id);

    const purchases = await Purchase.find({
      property: { $in: propertyIds },
      status: { $nin: ["none", "property_payment_review"] },
    })
      .populate(
        "property",
        "title price escrowFee serviceCharge address images",
      )
      .populate("buyer", "name email phoneNumber profilePicture")
      .populate("owner", "name email phoneNumber profilePicture")
      .populate("escrowHeldBy", "name email phoneNumber profilePicture")
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      properties,
      purchases,
    });
  } catch (err) {
    console.error("getAgentPurchases error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// Hides draft/unpaid statuses from admin list
const getAllPurchases = async (req, res) => {
  try {
    const purchases = await Purchase.find({
      status: { $nin: ["none", "property_payment_review"] },
    })
      .populate(
        "property",
        "title price escrowFee serviceCharge address images",
      )
      .populate("buyer", "name email phoneNumber profilePicture")
      .populate("owner", "name email phoneNumber profilePicture")
      .populate("escrowHeldBy", "name email phoneNumber profilePicture")
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      purchases,
    });
  } catch (err) {
    console.error("getAllPurchases error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = {
  requestPurchase,
  initializePurchasePayment,
  confirmPurchasePaymentCallback,
  verifyPurchasePayment,
  schedulePurchaseHandover,
  reschedulePurchaseHandover,
  confirmPurchaseHandover,
  completePurchaseHandover,
  changePurchaseStatus,
  getPurchaseDetails,
  getUserPurchases,
  getAgentPurchases,
  getAllPurchases,
};
