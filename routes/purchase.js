const express = require("express");
const router = express.Router();
const { protect, authorize } = require("../middleware/auth");
const {
  requestPurchase,
  initializePurchasePayment,
  verifyPurchasePayment,
  getPurchaseDetails,
  getUserPurchases,
  getAdminPurchases,
  getAllPurchases,
} = require("../controllers/purchaseController");

// ---------------------------
// Purchase Routes
// ---------------------------

// 1️⃣ Request Purchase (must have completed inspection first)
router.post("/purchase/request", protect, requestPurchase);

// 2️⃣ Initialize Purchase Payment (Paystack)
router.post("/purchase/initialize-payment", protect, initializePurchasePayment);

// 3️⃣ Verify Purchase Payment (Paystack)
router.post("/purchase/verify-payment", protect, verifyPurchasePayment);

// 4️⃣ Get Purchase Details
router.get("/purchase/:purchaseId", protect, getPurchaseDetails);

// Get All Purchases
router.get("/inspection/my-purchases", protect, getUserPurchases);

// Get All Purchases
router.get(
  "/inspection/my-purchases",
  protect,
  authorize("agent"),
  getAgentPurchases
);

// Get All Purchases
router.get(
  "/inspection/my-purchases",
  protect,
  authorize("admin"),
  getAllPurchases
);

module.exports = router;
