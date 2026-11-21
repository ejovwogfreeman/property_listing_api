const express = require("express");
const router = express.Router();
const multer = require("multer");
const upload = multer(); // Handles multipart/form-data text fields
const {
  getAllEscrows,
  getEscrowById,
  getAgentEscrows,
  changeEscrowStatus,
  approveEscrowRefund,
  completeEscrowRefund,
} = require("../controllers/escrow");
const {
  refundEscrowViaPaystack,
  refundRecordViaPaystack,
} = require("../controllers/paystackRefund");
const { protect, authorize } = require("../middlewares/auth");

router.get("/", protect, authorize("admin"), getAllEscrows);
router.get("/agent", protect, authorize("admin", "agent"), getAgentEscrows);
router.get("/:id", protect, authorize("admin", "agent"), getEscrowById);

router.patch(
  "/status",
  protect,
  authorize("admin"),
  upload.none(),
  changeEscrowStatus,
);

// Two-Step Manual Refund Flow Routes
router.patch(
  "/:id/refund-approval",
  protect,
  authorize("admin"),
  upload.none(),
  approveEscrowRefund,
);

router.patch(
  "/:id/refund-complete",
  protect,
  authorize("admin"),
  upload.none(),
  completeEscrowRefund,
);

// Refund straight through Paystack (instead of a manual bank transfer)
// Body: { waiveProcessingFee?, note? }
router.post(
  "/paystack-refund/:kind/:id",
  protect,
  authorize("admin"),
  upload.none(),
  refundRecordViaPaystack,
);

router.post(
  "/:id/paystack-refund",
  protect,
  authorize("admin"),
  upload.none(),
  refundEscrowViaPaystack,
);

module.exports = router;
