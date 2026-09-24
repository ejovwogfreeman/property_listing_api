const express = require("express");
const router = express.Router();
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
const { uploadDisputeFiles, uploadNone } = require("../middlewares/upload");

// 📌 User / Client Routes
router.post("/", protect, uploadDisputeFiles, createDispute);
router.get("/my-disputes", protect, getMyDisputes);

// 📌 Agent Routes
router.get("/agent-disputes", protect, authorize("agent"), getAgentDisputes);

// 📌 Admin Routes
router.get("/admin/all", protect, authorize("admin"), getAllDisputes);
router.put(
  "/:disputeId/status",
  protect,
  authorize("admin"),
  uploadNone,
  updateDisputeStatus,
);

// 📌 Shared / Thread Routes (Accessible by authorized User, Agent, or Admin)
router.get("/:disputeId", protect, getDisputeDetails);
router.post(
  "/:disputeId/messages",
  protect,
  uploadDisputeFiles,
  addDisputeMessage,
);

module.exports = router;
