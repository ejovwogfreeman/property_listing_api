const express = require("express");
const router = express.Router();
const multer = require("multer");
const upload = multer(); // Handles multipart/form-data text fields
const {
  requestInspection,
  initializeInspectionPayment,
  verifyInspectionPayment,
  scheduleInspection,
  rescheduleInspection,
  confirmInspection,
  completeInspection,
  changeInspectionStatus,
  getInspectionDetails,
  getUserInspections,
  getAgentInspections,
  getAllInspections,
} = require("../controllers/inspection");
const { protect, authorize } = require("../middlewares/auth");

// ---------------------------
// 1️⃣ Request Inspection (Buyer)
// POST /api/inspections/request
// Body: { propertyId }
// ---------------------------
router.post("/request", protect, upload.none(), requestInspection);

// ---------------------------
// 2️⃣ Initialize Inspection Payment (Paystack)
// POST /api/inspections/initialize-payment
// Body: { inspectionId, callback_url }
// ---------------------------
router.post(
  "/initialize-payment",
  protect,
  upload.none(),
  initializeInspectionPayment,
);

// ---------------------------
// 3️⃣ Verify Inspection Payment (Admin / System)
// POST /api/inspections/verify-payment
// Body: { inspectionId, reference }
// ---------------------------
router.post(
  "/verify-payment",
  protect,
  authorize("admin"),
  upload.none(),
  verifyInspectionPayment,
);

// ---------------------------
// 4️⃣ Schedule Inspection (Agent / Owner ONLY)
// PATCH /api/inspections/schedule
// Body: { inspectionId, scheduledDate }
// ---------------------------
router.patch(
  "/schedule",
  protect,
  upload.none(),
  authorize("agent", "admin"),
  scheduleInspection,
);

// ---------------------------
// 5️⃣ Reschedule / Reject Inspection (Buyer)
// PATCH /api/inspections/reschedule
// Body: { inspectionId, reason }
// ---------------------------
router.patch("/reschedule", protect, upload.none(), rescheduleInspection);

// ---------------------------
// 📂 Static GET Lists (Must come BEFORE /:inspectionId)
// ---------------------------
router.get("/user-inspections", protect, getUserInspections);

router.get(
  "/agent-inspections",
  protect,
  authorize("agent"),
  getAgentInspections,
);

router.get("/all-inspections", protect, authorize("admin"), getAllInspections);

// ---------------------------
// 6️⃣ Confirm / Accept Inspection (Owner)
// PATCH /api/inspections/:inspectionId/confirm
// ---------------------------
router.patch(
  "/:inspectionId/confirm",
  protect,
  upload.none(),
  confirmInspection,
  s,
);

// ---------------------------
// 7️⃣ Complete Inspection (Buyer)
// PATCH /api/inspections/:inspectionId/complete
// ---------------------------
router.patch(
  "/:inspectionId/complete",
  protect,
  upload.none(),
  completeInspection,
);

// ---------------------------
// 🔄 Change Inspection Status (Admin Fallback)
// PATCH /api/inspections/status/:inspectionId
// Body: { status }
// ---------------------------
router.patch(
  "/status/:inspectionId",
  protect,
  authorize("admin"),
  upload.none(),
  changeInspectionStatus,
);

// ---------------------------
// 8️⃣ Get Inspection Details (Single Item)
// GET /api/inspections/:inspectionId
// ---------------------------
router.get("/:inspectionId", protect, getInspectionDetails);

module.exports = router;
