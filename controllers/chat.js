// controllers/chatController.js
const Chat = require("../models/chat");
const Message = require("../models/message");

// ==========================
// 1. Create or Fetch a 1-on-1 Chat
// ==========================
createOrGetChat = async (req, res) => {
  try {
    const { userId } = req.body; // the other participant
    const loggedInUser = req.user._id;

    if (!userId) {
      return res.status(400).json({ message: "Missing userId" });
    }

    // Sort participants so unique index works
    const participants = [loggedInUser.toString(), userId.toString()].sort();

    // Check if chat exists
    let chat = await Chat.findOne({ participants });

    if (!chat) {
      // Create chat
      chat = await Chat.create({ participants });
    }

    res.json(chat);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// ==========================
// 2. Get all chats for logged-in user
// ==========================
getMyChats = async (req, res) => {
  try {
    const userId = req.user._id;

    const chats = await Chat.find({ participants: userId })
      .populate("participants", "username email avatar")
      .populate({
        path: "lastMessage",
        populate: { path: "sender", select: "username email avatar" },
      })
      .sort({ updatedAt: -1 });

    res.json(chats);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// ==========================
// 3. Get a single chat by ID
// ==========================
getChatById = async (req, res) => {
  try {
    const chatId = req.params.chatId;

    const chat = await Chat.findById(chatId)
      .populate("participants", "username email avatar")
      .populate({
        path: "lastMessage",
        populate: { path: "sender", select: "username avatar" },
      });

    if (!chat) {
      return res.status(404).json({ message: "Chat not found" });
    }

    res.json(chat);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// ==========================
// DELETE A CHAT
// ==========================
deleteChat = async (req, res) => {
  try {
    const { chatId } = req.params;
    const userId = req.user._id;

    const chat = await Chat.findById(chatId);

    if (!chat) {
      return res.status(404).json({ message: "Chat not found" });
    }

    // Only participants can delete the chat
    if (!chat.participants.includes(userId)) {
      return res
        .status(403)
        .json({ message: "Not allowed to delete this chat" });
    }

    // Delete all messages in this chat
    await Message.deleteMany({ chat: chat._id });

    // Delete chat
    await chat.deleteOne();

    res.json({ message: "Chat deleted successfully" });
  } catch (error) {
    console.error("Delete chat error:", error);
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  createOrGetChat,
  getMyChats,
  getChatById,
  deleteChat,
};
