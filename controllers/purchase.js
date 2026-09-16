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

// ---------------------------
// 1️⃣ Request Purchase
// ---------------------------
const requestPurchase = async (req, res) => {
  try {
    const { propertyId } = req.body;
    const buyerId = req.user._id;

    // Fetch property
    const property = await Property.findById(propertyId);
    if (!property)
      return res.status(404).json({ message: "Property not found" });

    // Check if user has completed inspection
    const inspection = await Inspection.findOne({
      property: propertyId,
      user: buyerId,
      status: "inspection_completed",
      feePaid: true,
    });
    if (!inspection)
      return res
        .status(400)
        .json({ message: "You must complete and pay for inspection first" });

    // Create purchase record (default status is "none")
    const purchase = await Purchase.create({
      property: property._id,
      buyer: buyerId,
      owner: property.owner,
      inspection: inspection._id,
      price: property.price,
      status: "none",
    });

    // Notify buyer
    await Notification.create({
      user: buyerId,
      title: "Purchase Requested",
      message: `Purchase requested for "${property.title}".`,
      meta: { purchaseId: purchase._id },
    });

    // Socket.io event
    if (global.io) {
      global.io.emit("notification", {
        type: "purchase_requested",
        title: "Purchase Requested",
        message: `Purchase requested for "${property.title}".`,
        purchaseId: purchase._id,
      });
    }

    res.status(201).json({
      success: true,
      message: "Purchase initiated. Proceed to payment.",
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

    // Find purchase
    const purchase = await Purchase.findById(purchaseId).populate("owner");
    if (!purchase)
      return res.status(404).json({ message: "Purchase not found" });

    if (purchase.buyer.toString() !== buyerId.toString())
      return res.status(403).json({ message: "Unauthorized" });

    if (purchase.feePaid)
      return res.status(400).json({ message: "Purchase already paid" });

    // Generate Paystack reference
    const reference = crypto.randomBytes(16).toString("hex");
    purchase.reference = reference;
    purchase.initializedAt = new Date();
    await purchase.save();

    // Initialize Paystack
    const init = await initializeTransaction(
      req.user.email,
      purchase.price * 100,
      reference,
      callback_url,
    );

    // Notify Buyer
    await Notification.create({
      user: buyerId,
      title: "Purchase Payment Initiated",
      message: `Your payment for purchase is initializing. Escrow will be created upon successful verification.`,
      meta: { purchaseId },
    });

    // Notify Seller
    await Notification.create({
      user: purchase.owner._id || purchase.owner,
      title: "Purchase Payment Started",
      message: `A buyer has initiated payment for your property.`,
      meta: { purchaseId },
    });

    // Notify Admin
    const adminUser = await User.findOne({ role: "admin" });
    if (adminUser) {
      await Notification.create({
        user: adminUser._id,
        title: "New Purchase Payment Started",
        message: `A new purchase transaction has been initiated by a buyer.`,
        meta: { purchaseId },
      });
    }

    if (global.io) {
      global.io.emit("notification", {
        type: "purchase_payment_initialized",
        title: "Purchase Payment Started",
        message: "A new purchase transaction has begun.",
        purchaseId,
      });
    }

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
// 3️⃣ Verify Purchase Payment (Paystack)
// ---------------------------
const verifyPurchasePayment = async (req, res) => {
  try {
    const { reference, purchaseId } = req.body;

    // Verify Paystack transaction
    const verification = await verifyTransaction(reference);
    if (!verification || verification.data.status !== "success")
      return res.status(400).json({ message: "Payment not successful" });

    // Find purchase
    const purchase = await Purchase.findById(purchaseId).populate("owner");
    if (!purchase)
      return res.status(404).json({ message: "Purchase not found" });

    // Get admin
    const adminUser = await User.findOne({ role: "admin" });

    // CREATE ESCROW UPON SUCCESSFUL PAYMENT VERIFICATION
    let escrow = await Escrow.findOne({ reference });
    if (!escrow) {
      escrow = await Escrow.create({
        reference: reference,
        property: purchase.property,
        buyer: purchase.buyer,
        seller: purchase.owner._id || purchase.owner,
        amount: purchase.price,
        status: "pending",
        type: "purchase",
      });
    }

    // UPDATE PURCHASE & STAMP paidAt
    purchase.feePaid = true;
    purchase.escrowHeldBy = adminUser ? adminUser._id : null;
    purchase.status = "property_payment_made";
    purchase.paidAt = new Date(); // 👈 Timestamp tracking
    await purchase.save();

    // NOTIFICATIONS
    await Notification.create({
      user: purchase.buyer,
      title: "Purchase Payment Verified",
      message: `Your purchase payment is verified and escrow has been created pending admin review.`,
      meta: { purchaseId, escrowId: escrow._id },
    });

    await Notification.create({
      user: purchase.owner._id || purchase.owner,
      title: "Purchase Payment Held in Escrow",
      message: `Payment for your property is verified and pending review.`,
      meta: { purchaseId, escrowId: escrow._id },
    });

    if (adminUser) {
      await Notification.create({
        user: adminUser._id,
        title: "New Purchase Escrow Pending Review",
        message: `Payment verified for purchase. New escrow is pending your review.`,
        meta: { purchaseId, escrowId: escrow._id },
      });
    }

    if (global.io) {
      global.io.emit("notification", {
        type: "purchase_payment_verified",
        title: "Purchase Payment Verified",
        message: "A purchase payment has been verified and escrow created.",
        purchaseId,
        escrowId: escrow._id,
      });
    }

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
// 4️⃣ Schedule Handover (Agent / Property Owner ONLY)
// ---------------------------
const schedulePurchaseHandover = async (req, res) => {
  try {
    const { purchaseId, scheduledDate } = req.body;
    const userId = req.user._id;

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
          "Unauthorized. Only the property owner or agent can schedule a handover date.",
      });
    }

    if (!purchase.feePaid) {
      return res.status(400).json({
        success: false,
        message:
          "Cannot schedule handover because the purchase payment has not been made yet.",
      });
    }

    // Update status and timestamp depending on whether it's a first-time schedule or a re-schedule
    const isReschedule = purchase.status === "handover_rescheduled";
    purchase.scheduledDate = scheduledDate;
    purchase.status = "handover_scheduled";
    purchase.scheduledAt = new Date();
    await purchase.save();

    // Notify Buyer
    await Notification.create({
      user: purchase.buyer,
      title: "Handover Date Scheduled",
      message: `The agent has scheduled your property handover for "${purchase.property?.title}" on ${new Date(scheduledDate).toLocaleString()}. Please confirm or request a reschedule if unsuitable.`,
      meta: { purchaseId },
    });

    if (global.io) {
      global.io.emit("notification", {
        type: "handover_scheduled",
        title: "Handover Scheduled",
        message: `A handover date has been set by the agent for "${purchase.property?.title}".`,
        purchaseId,
      });
    }

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
// 5️⃣ Reschedule / Reject Handover Date (User / Buyer)
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

    // Allow rescheduling if a handover is currently scheduled
    if (purchase.status !== "handover_scheduled") {
      return res.status(400).json({
        success: false,
        message:
          "You can only request a reschedule for a handover that has been scheduled.",
      });
    }

    // Shift to handover_rescheduled enum status
    purchase.status = "handover_rescheduled";
    purchase.scheduledDate = null;
    purchase.scheduledAt = null; // Clear out old schedule timestamp so a fresh one can be set
    await purchase.save();

    const sellerId = purchase.owner?._id || purchase.owner;
    if (sellerId) {
      await Notification.create({
        user: sellerId,
        title: "Handover Date Rejected / Reschedule Requested",
        message: `The buyer rejected the scheduled handover date for "${purchase.property?.title}". Reason: ${reason || "Not suitable"}. Please pick a new date.`,
        meta: { purchaseId },
      });
    }

    if (global.io) {
      global.io.emit("notification", {
        type: "handover_reschedule_requested",
        title: "Handover Reschedule Requested",
        message: `Buyer rejected the handover date for "${purchase.property?.title}".`,
        purchaseId,
      });
    }

    res.json({
      success: true,
      message:
        "Handover date rejected. The agent has been notified to pick a new date.",
      purchase,
    });
  } catch (err) {
    console.error("rescheduleHandover error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ---------------------------
// 6️⃣ Confirm / Accept Handover (User / Buyer ONLY)
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

    // Ensure only the buyer who requested it can confirm/accept the schedule
    if (purchase.buyer?.toString() !== userId.toString()) {
      return res.status(403).json({
        success: false,
        message:
          "Unauthorized. Only the buyer can confirm this handover schedule.",
      });
    }

    if (purchase.status !== "handover_scheduled") {
      return res.status(400).json({
        success: false,
        message:
          "Handover must be scheduled by the agent first before it can be confirmed.",
      });
    }

    purchase.status = "handover_confirmed";
    purchase.confirmedAt = new Date();
    await purchase.save();

    // Update associated escrow status to approved
    let escrow = await Escrow.findOne({
      property: purchase.property?._id,
      buyer: purchase.buyer,
      type: "purchase",
    });
    if (escrow) {
      escrow.status = "approved";
      await escrow.save();
    }

    const sellerId = purchase.owner?._id || purchase.owner;
    if (sellerId) {
      await Notification.create({
        user: sellerId,
        title: "Handover Confirmed by Buyer",
        message: `The buyer has accepted and confirmed the handover schedule for "${purchase.property?.title}".`,
        meta: { purchaseId },
      });
    }

    if (global.io) {
      global.io.emit("notification", {
        type: "handover_confirmed",
        title: "Handover Confirmed",
        message: `Handover confirmed by buyer for "${purchase.property?.title}".`,
        purchaseId,
      });
    }

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
// 7️⃣ Mark Handover Completed (User / Buyer)
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
        message:
          "Handover must be confirmed first before it can be marked as completed.",
      });
    }

    purchase.status = "handover_completed";
    purchase.completedAt = new Date();
    await purchase.save();

    const adminUser = await User.findOne({ role: "admin" });

    const sellerId = purchase.owner?._id || purchase.owner;
    if (sellerId) {
      await Notification.create({
        user: sellerId,
        title: "Handover Completed",
        message: `The property handover for "${purchase.property?.title}" has been marked as completed by the buyer.`,
        meta: { purchaseId },
      });
    }

    if (adminUser) {
      await Notification.create({
        user: adminUser._id,
        title: "Handover Completed - Review Escrow",
        message: `Handover for "${purchase.property?.title}" is completed. Escrow funds can now be released.`,
        meta: { purchaseId },
      });
    }

    if (global.io) {
      global.io.emit("notification", {
        type: "handover_completed",
        title: "Handover Completed",
        message: `Handover completed for "${purchase.property?.title}".`,
        purchaseId,
      });
    }

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

    // Allowed status transitions matching Purchase Model enum
    const allowedStatuses = [
      "none",
      "property_payment_made",
      "handover_requested",
      "handover_scheduled",
      "handover_rescheduled",
      "handover_confirmed",
      "handover_completed",
      "funds_released",
    ];

    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Invalid status provided.",
      });
    }

    const purchase = await Purchase.findById(purchaseId).populate("owner");
    if (!purchase) {
      return res
        .status(404)
        .json({ success: false, message: "Purchase not found" });
    }

    // Update status and dynamically set corresponding timestamps
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

    // If funds are released, update flags and sync escrow status
    if (status === "funds_released") {
      purchase.feeReleased = true;
      purchase.completedAt = purchase.completedAt || new Date();

      const escrow = await Escrow.findOne({
        property: purchase.property,
        buyer: purchase.buyer,
        type: "purchase",
      });
      if (escrow) {
        escrow.status = "released";
        await escrow.save();
      }
    }

    await purchase.save();

    const notificationMessage = `Your purchase status has been updated to: ${status.replace(/_/g, " ")}.`;

    // Notify Buyer
    await Notification.create({
      user: purchase.buyer,
      title: "Purchase Status Updated",
      message: notificationMessage,
      meta: { purchaseId, status },
    });

    // Notify Seller/Owner
    const sellerId = purchase.owner?._id || purchase.owner;
    if (sellerId) {
      await Notification.create({
        user: sellerId,
        title: "Property Purchase Status Updated",
        message: `The purchase status for your property has changed to: ${status.replace(/_/g, " ")}.`,
        meta: { purchaseId, status },
      });
    }

    if (global.io) {
      global.io.emit("notification", {
        type: "purchase_status_changed",
        title: "Purchase Status Updated",
        message: notificationMessage,
        purchaseId,
        status,
      });
    }

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
// 4️⃣ Get Purchase Details
// ---------------------------
const getPurchaseDetails = async (req, res) => {
  try {
    const { purchaseId } = req.params;

    const purchase = await Purchase.findById(purchaseId)
      .populate("property", "title price address")
      .populate("buyer", "name email phoneNumber profilePicture")
      .populate("owner", "name email phoneNumber profilePicture")
      .populate("inspection")
      .populate("escrowHeldBy", "name email phoneNumber profilePicture");

    if (!purchase)
      return res.status(404).json({ message: "Purchase not found" });

    res.json({ success: true, purchase });
  } catch (err) {
    console.error("getPurchaseDetails error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// Get All Purchases for Logged-in User
const getUserPurchases = async (req, res) => {
  try {
    const userId = req.params.id || req.user._id;

    const purchases = await Purchase.find({ buyer: userId })
      .populate("property", "title price address")
      .populate("owner", "name email phoneNumber profilePicture")
      .populate("inspection")
      .populate("escrowHeldBy", "name email phoneNumber profilePicture")
      .sort({ createdAt: -1 });

    res.json({ success: true, purchases });
  } catch (err) {
    console.error("getUserPurchases error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// Get all purchases of properties managed by the logged-in agent
const getAgentPurchases = async (req, res) => {
  try {
    const agentId = req.params.id || req.user._id;

    const properties = await Property.find(
      { agent: agentId },
      "_id title price address",
    );
    const propertyIds = properties.map((p) => p._id);

    const purchases = await Purchase.find({ property: { $in: propertyIds } })
      .populate("property", "title price address")
      .populate("buyer", "name email phoneNumber profilePicture")
      .populate("owner", "name email phoneNumber profilePicture")
      .populate("inspection")
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

// Get all purchases in the system
const getAllPurchases = async (req, res) => {
  try {
    const purchases = await Purchase.find()
      .populate("property", "title price address")
      .populate("buyer", "name email phoneNumber profilePicture")
      .populate("owner", "name email phoneNumber profilePicture")
      .populate("inspection")
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
