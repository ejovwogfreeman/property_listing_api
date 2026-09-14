const express = require("express");
const router = express.Router();
const multer = require("multer");
const upload = multer(); // Handles multipart/form-data text fields
const {
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
// 3️⃣ Verify Purchase Payment (Admin / System)
// POST /api/purchases/verify-payment
// Body: { purchaseId, reference }
// ---------------------------
router.post(
  "/verify-payment",
  protect,
  authorize("admin"),
  upload.none(),
  verifyPurchasePayment,
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
