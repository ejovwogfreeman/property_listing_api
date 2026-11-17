// routes/chat.js
const express = require("express");
const router = express.Router();
const multer = require("multer");
const upload = multer(); // Handles multipart/form-data text fields
const {
  createOrGetChat,
  getUserChats,
  getAllChats,
  getChatById,
  deleteChat,
} = require("../controllers/chat");

const { protect, authorize } = require("../middlewares/auth");

// ----------------------------------------
// 1. User creates or fetches a 1-on-1 chat for a property
// ----------------------------------------
router.post("/create-or-get", protect, upload.none(), createOrGetChat);

// ----------------------------------------
// 2. List user chats (dashboard)
// ----------------------------------------
router.get("/all-chats", protect, getUserChats);

// ----------------------------------------
// 3. Admin: List all platform chats
// ----------------------------------------
router.get("/all", protect, authorize("admin"), getAllChats);

// ----------------------------------------
// 4. Get a single chat by ID
// ----------------------------------------
router.get("/:chatId", protect, getChatById);

// ----------------------------------------
// 5. Delete a chat (and all messages) — Admin or chat participant check handled in controller
// ----------------------------------------
router.delete("/:chatId", protect, deleteChat);

module.exports = router;
