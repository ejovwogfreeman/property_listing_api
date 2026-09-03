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
      status: "inspection_confirmed", // or "verified" based on your inspection enum
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

    // Initialize Paystack
    const init = await initializeTransaction(
      req.user.email,
      purchase.price * 100,
      reference,
      callback_url,
    );

    // ------------------------------
    // NOTIFICATIONS (Escrow is NOT created here anymore)
    // ------------------------------

    // Notify Buyer
    await Notification.create({
      user: buyerId,
      title: "Purchase Payment Initiated",
      message: `Your payment for purchase is initializing. Escrow will be created upon successful verification.`,
      meta: { purchaseId },
    });

    // Notify Seller
    await Notification.create({
      user: purchase.owner,
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

    // ------------------------------
    // SOCKET EVENTS
    // ------------------------------
    if (global.io) {
      global.io.emit("notification", {
        type: "purchase_payment_initialized",
        title: "Purchase Payment Started",
        message: "A new purchase transaction has begun.",
        purchaseId,
      });
    }

    // ------------------------------
    // RESPONSE
    // ------------------------------
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
    if (verification.data.status !== "success")
      return res.status(400).json({ message: "Payment not successful" });

    // Find purchase
    const purchase = await Purchase.findById(purchaseId).populate("owner");
    if (!purchase)
      return res.status(404).json({ message: "Purchase not found" });

    // Get admin
    const adminUser = await User.findOne({ role: "admin" });

    // ------------------------------
    // CREATE ESCROW ONLY UPON SUCCESSFUL PAYMENT VERIFICATION
    // ------------------------------
    let escrow = await Escrow.findOne({ reference });
    if (!escrow) {
      escrow = await Escrow.create({
        reference: reference,
        property: purchase.property,
        buyer: purchase.buyer,
        seller: purchase.owner._id,
        amount: purchase.price,
        status: "pending", // Always pending for admin review/management later
        type: "purchase", // or "property_purchase" depending on your escrow schema enum
      });
    }

    // ------------------------------
    // UPDATE PURCHASE (Using enum "property_payment_made")
    // ------------------------------
    purchase.feePaid = true;
    purchase.escrowHeldBy = adminUser ? adminUser._id : null;
    purchase.status = "property_payment_made"; // 👈 Matches your PurchaseSchema enum
    await purchase.save();

    // ------------------------------
    // NOTIFICATIONS
    // ------------------------------

    // Notify Buyer
    await Notification.create({
      user: purchase.buyer,
      title: "Purchase Payment Verified",
      message: `Your purchase payment is verified and escrow has been created pending admin review.`,
      meta: { purchaseId, escrowId: escrow._id },
    });

    // Notify Seller
    await Notification.create({
      user: purchase.owner._id,
      title: "Purchase Payment Held in Escrow",
      message: `Payment for your property is verified and pending review.`,
      meta: { purchaseId, escrowId: escrow._id },
    });

    // Notify Admin
    if (adminUser) {
      await Notification.create({
        user: adminUser._id,
        title: "New Purchase Escrow Pending Review",
        message: `Payment verified for purchase. New escrow is pending your review.`,
        meta: { purchaseId, escrowId: escrow._id },
      });
    }

    // ------------------------------
    // SOCKET EVENT
    // ------------------------------
    if (global.io) {
      global.io.emit("notification", {
        type: "purchase_payment_verified",
        title: "Purchase Payment Verified",
        message: "A purchase payment has been verified and escrow created.",
        purchaseId,
        escrowId: escrow._id,
      });
    }

    // ------------------------------
    // RESPONSE
    // ------------------------------
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
// 🔄 Change Purchase Status (Admin Only)
// ---------------------------
const changePurchaseStatus = async (req, res) => {
  try {
    const { purchaseId } = req.params;
    const { status } = req.body;
    const adminId = req.user._id;

    // Allowed status transitions from your Purchase Schema enum
    const allowedStatuses = [
      "none",
      "property_payment_made",
      "handover_requested",
      "handover_scheduled",
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

    // Find purchase and populate details
    const purchase = await Purchase.findById(purchaseId).populate("owner");
    if (!purchase) {
      return res
        .status(404)
        .json({ success: false, message: "Purchase not found" });
    }

    // Update purchase status
    purchase.status = status;

    // Optional business logic: if funds are released, update flags
    if (status === "funds_released") {
      purchase.feeReleased = true;

      // Also update related escrow to approved/released if you use an Escrow model
      const escrow = await Escrow.findOne({
        property: purchase.property,
        buyer: purchase.buyer,
        type: "purchase",
      });
      if (escrow) {
        escrow.status = "released"; // or "approved" depending on your escrow schema
        await escrow.save();
      }
    }

    await purchase.save();

    // ------------------------------
    // NOTIFICATIONS
    // ------------------------------
    const notificationMessage = `Your purchase status has been updated to: ${status.replace(/_/g, " ")}.`;

    // Notify Buyer
    await Notification.create({
      user: purchase.buyer,
      title: "Purchase Status Updated",
      message: notificationMessage,
      meta: { purchaseId, status },
    });

    // Notify Seller/Owner
    await Notification.create({
      user: purchase.owner._id,
      title: "Property Purchase Status Updated",
      message: `The purchase status for your property has changed to: ${status.replace(/_/g, " ")}.`,
      meta: { purchaseId, status },
    });

    // ------------------------------
    // SOCKET EVENT
    // ------------------------------
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
      .populate("buyer", "name email")
      .populate("owner", "name email")
      .populate("inspection")
      .populate("escrowHeldBy", "name email");

    if (!purchase)
      return res.status(404).json({ message: "Purchase not found" });

    res.json({ success: true, purchase });
  } catch (err) {
    console.error("getPurchaseDetails error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ---------------------------
// Get All Purchases for Logged-in User
// ---------------------------
const getUserPurchases = async (req, res) => {
  try {
    const userId = req.params.id || req.user._id;

    const purchases = await Purchase.find({ buyer: userId })
      .populate("property", "title price address")
      .populate("owner", "name email")
      .populate("inspection")
      .populate("escrowHeldBy", "name email")
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
      .populate("buyer", "name email")
      .populate("owner", "name email")
      .populate("inspection")
      .populate("escrowHeldBy", "name email")
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
      .populate("buyer", "name email")
      .populate("owner", "name email")
      .populate("inspection")
      .populate("escrowHeldBy", "name email")
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
  changePurchaseStatus,
  getPurchaseDetails,
  getUserPurchases,
  getAgentPurchases,
  getAllPurchases,
};
