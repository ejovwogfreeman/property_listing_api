const Purchase = require("../models/Purchase");
const Property = require("../models/Property");
const Inspection = require("../models/Inspection");
const User = require("../models/User");
const Notification = require("../models/Notification");
const {
  initializeTransaction,
  verifyTransaction,
} = require("../middlewares/paystack");
const crypto = require("crypto");

// ---------------------------
// 1️⃣ Request Purchase
// ---------------------------
requestPurchase = async (req, res) => {
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
      status: "verified",
      feePaid: true,
    });
    if (!inspection)
      return res
        .status(400)
        .json({ message: "You must complete and pay for inspection first" });

    // Create purchase record
    const purchase = await Purchase.create({
      property: property._id,
      buyer: buyerId,
      owner: property.owner,
      inspection: inspection._id,
      price: property.price,
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
initializePurchasePayment = async (req, res) => {
  try {
    const { purchaseId } = req.body;
    const buyerId = req.user._id;

    const purchase = await Purchase.findById(purchaseId).populate("owner");
    if (!purchase)
      return res.status(404).json({ message: "Purchase not found" });
    if (purchase.buyer.toString() !== buyerId.toString())
      return res.status(403).json({ message: "Unauthorized" });
    if (purchase.feePaid)
      return res.status(400).json({ message: "Purchase already paid" });

    // Generate unique reference
    const reference = crypto.randomBytes(16).toString("hex");

    // Initialize Paystack transaction
    const init = await initializeTransaction(
      req.user.email,
      purchase.price * 100,
      reference
    );

    res.json({
      success: true,
      authorizationUrl: init.data.authorization_url,
      reference,
      purchaseId: purchase._id,
    });
  } catch (err) {
    console.error("initializePurchasePayment error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ---------------------------
// 3️⃣ Verify Purchase Payment (Paystack)
// ---------------------------
verifyPurchasePayment = async (req, res) => {
  try {
    const { reference, purchaseId } = req.body;

    const verification = await verifyTransaction(reference);
    if (verification.data.status !== "success")
      return res.status(400).json({ message: "Payment not successful" });

    const purchase = await Purchase.findById(purchaseId);
    if (!purchase)
      return res.status(404).json({ message: "Purchase not found" });

    const adminUser = await User.findOne({ role: "admin" });

    purchase.feePaid = true;
    purchase.escrowHeldBy = adminUser._id;
    purchase.status = "paid";
    await purchase.save();

    // Notify buyer
    await Notification.create({
      user: purchase.buyer,
      title: "Purchase Fee Paid",
      message: `Your purchase payment is successful and held in escrow.`,
      meta: { purchaseId },
    });

    // Notify property owner
    await Notification.create({
      user: purchase.owner,
      title: "Property Purchase Initiated",
      message: `Your property "${purchase.property}" is being purchased.`,
      meta: { purchaseId },
    });

    // Socket.io event
    if (global.io) {
      global.io.emit("notification", {
        type: "purchase_fee_paid",
        title: "Purchase Fee Paid",
        message: `Purchase payment for property held in escrow.`,
        purchaseId,
      });
    }

    res.json({
      success: true,
      message: "Payment verified successfully. Await admin release.",
      purchase,
    });
  } catch (err) {
    console.error("verifyPurchasePayment error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ---------------------------
// 4️⃣ Get Purchase Details
// ---------------------------
getPurchaseDetails = async (req, res) => {
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
getUserPurchases = async (req, res) => {
  try {
    const userId = req.user._id;

    const purchases = await Purchase.find({ buyer: userId })
      .populate("property", "title price address")
      .populate("owner", "name email")
      .populate("inspection")
      .populate("escrowHeldBy", "name email") // admin holding escrow
      .sort({ createdAt: -1 });

    res.json({ success: true, purchases });
  } catch (err) {
    console.error("getMyPurchases error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// Get all purchases of properties managed by the logged-in agent
getAgentPurchases = async (req, res) => {
  try {
    const agentId = req.user._id;

    // Fetch properties where the logged-in user is the agent
    const properties = await Property.find(
      { agent: agentId },
      "_id title price address"
    );
    const propertyIds = properties.map((p) => p._id);

    // Get purchases for these properties
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
getAllPurchases = async (req, res) => {
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
  getPurchaseDetails,
  getUserPurchases,
  getAgentPurchases,
  getAllPurchases,
};
