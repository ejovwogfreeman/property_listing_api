const express = require("express");
const router = express.Router();
const multer = require("multer");
const upload = multer(); // Handles multipart/form-data text fields
const {
  requestInspection,
  // verifyInspectionCode,
  initializeInspectionPayment,
  verifyInspectionPayment,
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
// 2️⃣ Verify Inspection Code
// POST /api/inspections/verify-code
// Body: { inspectionId, code }
// ---------------------------
// router.post("/verify-code", protect, verifyInspectionCode);

// ---------------------------
// 3️⃣ Initialize Inspection Payment
// POST /api/inspections/init-payment
// Body: { inspectionId }
// ---------------------------
router.post(
  "/initialize-payment",
  protect,
  upload.none(),
  initializeInspectionPayment,
);

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
router.patch(
  "status/:inspectionId",
  protect,
  authorize("admin"),
  upload.none(),
  changeInspectionStatus,
);

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

// ---------------------------
// 5️⃣ Get Inspection Details
// GET /api/inspections/:inspectionId
// ---------------------------
router.get("/:inspectionId", protect, getInspectionDetails);

module.exports = router;
