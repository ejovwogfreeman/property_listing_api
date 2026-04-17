const express = require("express");
const router = express.Router();
const {
  requestPurchase,
  initializePurchasePayment,
  verifyPurchasePayment,
  getPurchaseDetails,
  getUserPurchases,
  getAgentPurchases,
  getAllPurchases,
} = require("../controllers/purchase");
const { protect, authorize } = require("../middlewares/auth");

// ---------------------------
// Purchase Routes
// ---------------------------

// 1️⃣ Request Purchase (must have completed inspection first)
router.post("/request", protect, requestPurchase);

// 2️⃣ Initialize Purchase Payment (Paystack)
router.post(
  "/initialize-payment",
  protect,
  authorize("admin"),
  initializePurchasePayment,
);

// 3️⃣ Verify Purchase Payment (Paystack)
router.post("/verify-payment", protect, verifyPurchasePayment);

// 4️⃣ Get Purchase Details
router.get("/:purchaseId", protect, getPurchaseDetails);

// Get All Purchases
router.get("/user-purchases", protect, getUserPurchases);

// Get All Purchases
router.get("/agent-purchases", protect, authorize("agent"), getAgentPurchases);

// Get All Purchases
router.get("/all-purchases", protect, authorize("admin"), getAllPurchases);

module.exports = router;
