const express = require("express");
const router = express.Router();
const {
  requestInspection,
  verifyInspectionCode,
  initializeInspectionPayment,
  verifyInspectionPayment,
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
router.post("/request", protect, requestInspection);

// ---------------------------
// 2️⃣ Verify Inspection Code
// POST /api/inspections/verify-code
// Body: { inspectionId, code }
// ---------------------------
router.post("/verify-code", protect, verifyInspectionCode);

// ---------------------------
// 3️⃣ Initialize Inspection Payment
// POST /api/inspections/init-payment
// Body: { inspectionId }
// ---------------------------
router.post("/initialize-payment", protect, initializeInspectionPayment);

// ---------------------------
// 4️⃣ Verify Inspection Payment
// POST /api/inspections/verify-payment
// Body: { inspectionId, reference }
// ---------------------------
router.post(
  "/verify-payment",
  protect,
  authorize("admin"),
  verifyInspectionPayment,
);

// ---------------------------
// 5️⃣ Get Inspection Details
// GET /api/inspections/:inspectionId
// ---------------------------
router.get("/:inspectionId", protect, getInspectionDetails);

// ---------------------------
// Get All Inspections of loggedn in user
// GET /api/inspections
// ---------------------------
router.get("/user-inspections", protect, getUserInspections);

// ---------------------------
// Get All Inspections of loggedn in agent
// ---------------------------
router.get(
  "/agent-inspections",
  protect,
  authorize("agent"),
  getAgentInspections,
);

// ---------------------------
// Get All Inspections of loggedn in agent
// ---------------------------
router.get("/all-inspections", protect, authorize("admin"), getAllInspections);

module.exports = router;
