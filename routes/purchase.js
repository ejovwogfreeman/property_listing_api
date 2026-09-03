const express = require("express");
const router = express.Router();
const multer = require("multer");
const upload = multer(); // Handles multipart/form-data text fields
const {
  requestPurchase,
  initializePurchasePayment,
  // verifyPurchasePayment,
  changePurchaseStatus,
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
router.post("/request", protect, upload.none(), requestPurchase);

// 2️⃣ Initialize Purchase Payment (Paystack)
router.post(
  "/initialize-payment",
  protect,
  upload.none(),
  initializePurchasePayment,
);

// 3️⃣ Verify Purchase Payment (Paystack)
router.post(
  "/verify-payment",
  protect,
  authorize("admin"),
  verifyPurchasePayment,
);

router.patch(
  "status/:purchaseId",
  protect,
  authorize("admin"),
  upload.none(),
  changePurchaseStatus,
);
// Get All Purchases
router.get("/all-purchases", protect, authorize("admin"), getAllPurchases);

// 4️⃣ Get Purchase Details
router.get("/:purchaseId", protect, getPurchaseDetails);

// Get All Purchases
router.get("/user-purchases/:id", protect, getUserPurchases);

// Get All Purchases
router.get(
  "/agent-purchases/:id",
  protect,
  authorize("agent"),
  getAgentPurchases,
);

module.exports = router;
