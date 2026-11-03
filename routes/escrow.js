const express = require("express");
const router = express.Router();
const multer = require("multer");
const upload = multer(); // Handles multipart/form-data text fields
const {
  getAllEscrows,
  getEscrowById,
  getAgentEscrows,
  changeEscrowStatus,
  refundEscrow,
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
router.patch(
  "/:id/refund",
  protect,
  authorize("admin"),
  upload.none(),
  refundEscrow,
);

module.exports = router;
