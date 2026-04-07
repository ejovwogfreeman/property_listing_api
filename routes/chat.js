// routes/chat.js
const express = require("express");
const router = express.Router();
const {
  createOrGetChat,
  getChatById,
  deleteChat,
  getAgentChats,
  getAllChats, // admin/agent listing
} = require("../controllers/chat");

const { protect, authorize } = require("../middlewares/auth");

// ----------------------------------------
// 1. User creates or fetches a 1-on-1 chat for a property
// ----------------------------------------
router.post("/create-or-get", protect, createOrGetChat);

// ----------------------------------------
// 2. Get a single chat by ID (property chat for user)
// ----------------------------------------
router.get("/:chatId", protect, getChatById);

// ----------------------------------------
// 3. Delete a chat (and all messages) — can be limited to admin/agent if desired
// ----------------------------------------
router.delete("/:chatId", protect, deleteChat);

// ----------------------------------------
// 4. Admin/Agent: List all chats (dashboard)
// ----------------------------------------
router.get("/agent", protect, authorize("admin", "agent"), getAgentChats);

// ----------------------------------------
// 5. Admin/Agent: List all chats (dashboard)
// ----------------------------------------
router.get("/all", protect, authorize("admin"), getAllChats);

module.exports = router;
