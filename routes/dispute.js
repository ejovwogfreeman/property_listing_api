const express = require("express");
const router = express.Router();
const multer = require("multer");
const upload = multer(); // Handles multipart/form-data text fields
const {
  createDispute,
  addDisputeMessage,
  updateDisputeStatus,
  getDisputeDetails,
  getMyDisputes,
  getAgentDisputes,
  getAllDisputes,
} = require("../controllers/dispute");

const { protect, authorize } = require("../middlewares/auth");

// 📌 User / Client Routes
router.post("/", protect, upload.none(), createDispute);
router.get("/my-disputes", protect, getMyDisputes);

// 📌 Agent Routes
router.get("/agent-disputes", protect, authorize("agent"), getAgentDisputes);

// 📌 Admin Routes
router.get("/admin/all", protect, authorize("admin"), getAllDisputes);
router.put(
  "/:disputeId/status",
  protect,
  authorize("admin"),
  upload.none(),
  updateDisputeStatus,
);

// 📌 Shared / Thread Routes (Accessible by authorized User, Agent, or Admin)
router.get("/:disputeId", protect, getDisputeDetails);
router.post("/:disputeId/messages", protect, upload.none(), addDisputeMessage);

module.exports = router;
