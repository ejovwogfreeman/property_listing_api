const express = require("express");
const router = express.Router();
const {
  requestInspection,
  verifyInspectionCode,
  initializeInspectionPayment,
  verifyInspectionPayment,
  getInspectionDetails,
  getInspections,
} = require("../controllers/inspectionController");
const { protect } = require("../middleware/auth"); // your protect middleware

// ---------------------------
// 1️⃣ Request Inspection
// POST /api/inspections/request
// Body: { propertyId }
// ---------------------------
router.post("/inspection/request", protect, requestInspection);

// ---------------------------
// 2️⃣ Verify Inspection Code
// POST /api/inspections/verify-code
// Body: { inspectionId, code }
// ---------------------------
router.post("/inspection/verify-code", protect, verifyInspectionCode);

// ---------------------------
// 3️⃣ Initialize Inspection Payment
// POST /api/inspections/init-payment
// Body: { inspectionId }
// ---------------------------
router.post("/inspection/init-payment", protect, initializeInspectionPayment);

// ---------------------------
// 4️⃣ Verify Inspection Payment
// POST /api/inspections/verify-payment
// Body: { inspectionId, reference }
// ---------------------------
router.post("/inspection/verify-payment", protect, verifyInspectionPayment);

// ---------------------------
// 5️⃣ Get Inspection Details
// GET /api/inspections/:inspectionId
// ---------------------------
router.get("/inspection/:inspectionId", protect, getInspectionDetails);

// ---------------------------
// Get All Inspections
// GET /api/inspections
// ---------------------------
router.get("/inspection/my-inspections", protect, getInspections);

module.exports = router;
