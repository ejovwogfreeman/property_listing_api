// controllers/chatController.js
const Chat = require("../models/chat");
const Message = require("../models/message");
const Property = require("../models/property");

// ==========================
// 1. Create or Fetch a 1-on-1 Chat
// ==========================
const createOrGetChat = async (req, res) => {
  try {
    const { agentId, propertyId } = req.body;
    const userId = req.user._id;

    if (!agentId || !propertyId) {
      return res.status(400).json({
        message: "agentId and propertyId are required",
      });
    }

    if (userId.toString() === agentId.toString()) {
      return res.status(400).json({
        message: "You cannot chat with yourself",
      });
    }

    // ✅ populate owner so owner._id works safely
    const property = await Property.findById(propertyId).populate("owner");

    if (!property) {
      return res.status(404).json({
        message: "Property not found",
      });
    }

    // ✅ safe owner check (works only when owner is populated)
    if (property.owner._id.toString() !== agentId.toString()) {
      return res.status(400).json({
        message: "This property does not belong to this agent",
      });
    }

    // ✅ normalize participants to prevent duplicates
    const participants = [userId.toString(), agentId.toString()].sort();

    // ✅ check if chat already exists for this user-agent-property
    let chat = await Chat.findOne({
      property: propertyId,
      participants,
    });

    // ✅ if not found, create new chat
    if (!chat) {
      try {
        chat = await Chat.create({
          participants,
          property: propertyId,
        });
      } catch (err) {
        // handle race condition (double request safety)
        chat = await Chat.findOne({
          property: propertyId,
          participants,
        });
      }
    }

    return res.status(200).json(chat);
  } catch (error) {
    return res.status(500).json({
      message: error.message,
    });
  }
};

// ==========================
// 2. Get all chats for the logged-in user
// ==========================
const getUserChats = async (req, res) => {
  try {
    const userId = req.user._id;

    const chats = await Chat.find({
      participants: userId,
    })
      .populate("participants", "username email avatar")
      .populate("property", "title price images")
      .populate({
        path: "lastMessage",
        populate: {
          path: "sender",
          select: "username email avatar",
        },
      })
      .sort({ updatedAt: -1 });

    return res.json(chats);
  } catch (error) {
    console.error("Get user chats error:", error);
    return res.status(500).json({ message: error.message });
  }
};

// ==========================
// 3. Get all chats
// ==========================
const getAllChats = async (req, res) => {
  try {
    const chats = await Chat.find()
      .populate("participants", "username email")
      .populate("property", "title address")
      .populate({
        path: "lastMessage",
        populate: { path: "sender", select: "username email" },
      })
      .sort({ updatedAt: -1 });

    res.json(chats);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ==========================
// 4. Get a single chat by ID
// ==========================
const getChatById = async (req, res) => {
  try {
    const chatId = req.params.chatId;
    const userId = req.user._id;

    const chat = await Chat.findById(chatId)
      .populate("participants", "username email avatar")
      .populate("property", "title price images")
      .populate({
        path: "lastMessage",
        populate: { path: "sender", select: "username avatar" },
      });

    if (!chat) {
      return res.status(404).json({ message: "Chat not found" });
    }

    // ✅ SECURITY CHECK
    // ✅ FIXED SECURITY CHECK
    const isParticipant = chat.participants.some(
      (p) => p._id.toString() === userId.toString(),
    );

    if (!isParticipant) {
      return res.status(403).json({ message: "Access denied" });
    }

    res.json(chat);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// ==========================
// 5. DELETE A CHAT
// ==========================
const deleteChat = async (req, res) => {
  try {
    const { chatId } = req.params;
    const userId = req.user._id;

    const chat = await Chat.findById(chatId);

    if (!chat) {
      return res.status(404).json({ message: "Chat not found" });
    }

    if (!chat.participants.some((p) => p.toString() === userId.toString())) {
      return res
        .status(403)
        .json({ message: "Not allowed to delete this chat" });
    }

    await Message.deleteMany({ chat: chat._id });
    await chat.deleteOne();

    res.json({ message: "Chat deleted successfully" });
  } catch (error) {
    console.error("Delete chat error:", error);
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  createOrGetChat,
  getUserChats,
  getAllChats,
  getChatById,
  deleteChat,
};
