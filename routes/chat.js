const express = require("express");
const router = express.Router();
const {
  createOrGetChat,
  getMyChats,
  getChatById,
  deleteChat,
} = require("../controllers/chat");

const { protect, authorize } = require("../middlewares/auth");

// -------------------------
// 1. Create or fetch a 1-on-1 chat
// -------------------------
router.post("/create-or-get", protect, createOrGetChat);

// -------------------------
// 2. Get all chats for logged-in user
// -------------------------
router.get("/", protect, getMyChats);

// -------------------------
// 3. Get a single chat by ID
// -------------------------
router.get("/:chatId", protect, getChatById);

// -------------------------
// 4. Delete a chat (and all its messages)
// -------------------------
router.delete("/:chatId", protect, deleteChat);

module.exports = router;
