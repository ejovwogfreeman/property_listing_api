const express = require("express");
const router = express.Router();
const multer = require("multer");
const upload = multer(); // Handles multipart/form-data text fields
const {
  getAllEscrows,
  getEscrowById,
  getAgentEscrows,
  changeEscrowStatus,
} = require("../controllers/escrow");
const { protect, authorize } = require("../middlewares/auth");

router.get("/", protect, authorize("admin"), getAllEscrows);
router.get("/agent", protect, authorize("agent"), getAgentEscrows);
router.get(
  "/:id",
  protect,
  authorize("admin"),
  authorize("agent"),
  getEscrowById,
);
router.patch(
  "/status",
  protect,
  authorize("admin"),
  upload.none(),
  changeEscrowStatus,
);

module.exports = router;
