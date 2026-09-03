const express = require("express");
const router = express.Router();
const multer = require("multer");
const upload = multer(); // Handles multipart/form-data text fields
const {
  requestInspection,
  initializeInspectionPayment,
  verifyInspectionPayment,
  scheduleInspection,
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
// 1️⃣ Request Inspection
// POST /api/inspections/request
// Body: { propertyId }
// ---------------------------
router.post("/request", protect, upload.none(), requestInspection);

// ---------------------------
// 2️⃣ Initialize Inspection Payment
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
// 3️⃣ Verify Inspection Payment
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
// 4️⃣ Schedule Inspection (User / Buyer)
// PATCH /api/inspections/schedule
// Body: { inspectionId, scheduledDate }
// ---------------------------
router.patch("/schedule", protect, upload.none(), scheduleInspection);

// ---------------------------
// 5️⃣ Confirm Inspection (Agent / Property Owner)
// PATCH /api/inspections/:inspectionId/confirm
// ---------------------------
router.patch(
  "/:inspectionId/confirm",
  protect,
  upload.none(),
  confirmInspection,
);

// ---------------------------
// 6️⃣ Complete Inspection (User / Buyer)
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
// Get All Inspections of logged-in user
// GET /api/inspections/user-inspections
// ---------------------------
router.get("/user-inspections", protect, getUserInspections);

// ---------------------------
// Get All Inspections of logged-in agent
// GET /api/inspections/agent-inspections
// ---------------------------
router.get(
  "/agent-inspections",
  protect,
  authorize("agent"),
  getAgentInspections,
);

// ---------------------------
// Get All Inspections System-wide (Admin)
// GET /api/inspections/all-inspections
// ---------------------------
router.get("/all-inspections", protect, authorize("admin"), getAllInspections);

// ---------------------------
// Get Single Inspection Details
// GET /api/inspections/:inspectionId
// ---------------------------
router.get("/:inspectionId", protect, getInspectionDetails);

module.exports = router;
