const express = require("express");
const router = express.Router();
const {
  sendMessage,
  getMessages,
  updateMessage,
  deleteMessage,
} = require("../controllers/messageController");

const { protect, authorize } = require("../middlewares/auth");
const { uploadChatAttachments, uploadNone } = require("../middlewares/upload");

// -------------------------
// SEND MESSAGE
// -------------------------
// Use uploadPropertyFiles.fields(...) for multiple files
router.post("/send", protect, uploadChatAttachments, sendMessage);

// -------------------------
// GET MESSAGES (with pagination)
// -------------------------
router.get("/:chatId", protect, getMessages);

// -------------------------
// UPDATE MESSAGE TEXT ONLY
// -------------------------
router.put("/update/:messageId", protect, updateMessage);

// -------------------------
// DELETE MESSAGE
// -------------------------
router.delete("/delete/:messageId", protect, deleteMessage);

module.exports = router;
