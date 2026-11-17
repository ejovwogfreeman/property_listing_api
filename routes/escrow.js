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

module.exports = router;
