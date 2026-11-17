const express = require("express");
const router = express.Router();
const multer = require("multer");
const upload = multer(); // Handles multipart/form-data text fields
const {
  requestPurchase,
  initializePurchasePayment,
  confirmPurchasePaymentCallback,
  verifyPurchasePayment,
  rejectPurchasePayment,
  markPurchaseRefundSent,
  schedulePurchaseHandover,
  reschedulePurchaseHandover,
  confirmPurchaseHandover,
  completePurchaseHandover,
  changePurchaseStatus,
  getPurchaseDetails,
  getUserPurchases,
  getAgentPurchases,
  getAllPurchases,
} = require("../controllers/purchase");
const { protect, authorize } = require("../middlewares/auth");

// ---------------------------
// 1️⃣ Request Purchase (Buyer)
// POST /api/purchases/request
// Body: { propertyId }
// ---------------------------
router.post("/request", protect, upload.none(), requestPurchase);

// ---------------------------
// 2️⃣ Initialize Purchase Payment (Paystack)
// POST /api/purchases/initialize-payment
// Body: { purchaseId, callback_url }
// ---------------------------
router.post(
  "/initialize-payment",
  protect,
  upload.none(),
  initializePurchasePayment,
);

// ---------------------------
// 2.1 Confirm Payment Callback (Buyer)
// POST /api/purchases/confirm-payment
// Body: { purchaseId, reference }
// ---------------------------
router.post(
  "/confirm-payment",
  protect,
  upload.none(),
  confirmPurchasePaymentCallback,
);

// ---------------------------
// 3️⃣ Verify & Approve Purchase Payment (Admin Only)
// POST /api/purchases/verify-payment
// Body: { purchaseId }
// ---------------------------
router.post(
  "/verify-payment",
  protect,
  authorize("admin"),
  upload.none(),
  verifyPurchasePayment,
);

// ---------------------------
// 3.1 Reject Purchase Payment (Admin Only)
// POST /api/purchases/reject-payment
// Body: { id, reason }
// ---------------------------
router.post(
  "/reject-payment",
  protect,
  authorize("admin"),
  upload.none(),
  rejectPurchasePayment,
);

// ---------------------------
// 3.2 Mark Purchase Refund Sent (Admin Only)
// POST /api/purchases/mark-refund-sent
// Body: { id, amountSent, transferReference, note }
// ---------------------------
router.post(
  "/mark-refund-sent",
  protect,
  authorize("admin"),
  upload.none(),
  markPurchaseRefundSent,
);

// ---------------------------
// 4️⃣ Schedule Purchase Handover (Agent / Owner ONLY)
// PATCH /api/purchases/schedule
// Body: { purchaseId, scheduledDate }
// ---------------------------
router.patch(
  "/schedule",
  protect,
  upload.none(),
  authorize("agent", "admin"),
  schedulePurchaseHandover,
);

// ---------------------------
// 5️⃣ Reschedule / Reject Purchase Handover (Buyer)
// PATCH /api/purchases/reschedule
// Body: { purchaseId, reason }
// ---------------------------
router.patch("/reschedule", protect, upload.none(), reschedulePurchaseHandover);

// ---------------------------
// 📂 Static GET Lists (Must come BEFORE /:purchaseId)
// ---------------------------
router.get("/user-purchases", protect, getUserPurchases);

router.get("/agent-purchases", protect, authorize("agent"), getAgentPurchases);

router.get("/all-purchases", protect, authorize("admin"), getAllPurchases);

// ---------------------------
// 6️⃣ Confirm / Accept Purchase Handover (Buyer)
// PATCH /api/purchases/:purchaseId/confirm
// ---------------------------
router.patch(
  "/:purchaseId/confirm",
  protect,
  upload.none(),
  confirmPurchaseHandover,
);

// ---------------------------
// 7️⃣ Complete Purchase Handover (Buyer)
// PATCH /api/purchases/:purchaseId/complete
// ---------------------------
router.patch(
  "/:purchaseId/complete",
  protect,
  upload.none(),
  completePurchaseHandover,
);

// ---------------------------
// 🔄 Change Purchase Status (Admin Fallback)
// PATCH /api/purchases/status/:purchaseId
// Body: { status }
// ---------------------------
router.patch(
  "/status/:purchaseId",
  protect,
  authorize("admin"),
  upload.none(),
  changePurchaseStatus,
);

// ---------------------------
// 8️⃣ Get Purchase Details (Single Item)
// GET /api/purchases/:purchaseId
// ---------------------------
router.get("/:purchaseId", protect, getPurchaseDetails);

module.exports = router;
