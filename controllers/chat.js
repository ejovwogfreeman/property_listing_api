// controllers/chatController.js
const Chat = require("../models/chat");
const Message = require("../models/message");

// ==========================
// 1. Create or Fetch a 1-on-1 Chat
// ==========================
const createOrGetChat = async (req, res) => {
  console.log(req.body);
  try {
    const { userId, propertyId } = req.body;
    const loggedInUser = req.user._id;

    if (!userId || !propertyId) {
      return res
        .status(400)
        .json({ message: "userId and propertyId are required" });
    }

    // Sort participants
    const participants = [loggedInUser.toString(), userId.toString()].sort();

    // ✅ IMPORTANT: include property
    let chat = await Chat.findOne({
      participants,
      property: propertyId,
    });

    if (!chat) {
      chat = await Chat.create({
        participants,
        property: propertyId,
      });
    }

    res.json(chat);
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: error.message });
  }
};

// ==========================
// 2. Get a single chat by ID
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
    if (!chat.participants.includes(userId)) {
      return res.status(403).json({ message: "Access denied" });
    }

    res.json(chat);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// ==========================
// 3. Get all chats for the logged-in agent
// ==========================
const getAgentChats = async (req, res) => {
  try {
    const agentId = req.user._id;

    // Fetch all chats where the property belongs to this agent
    const chats = await Chat.find()
      .populate({
        path: "property",
        match: { agent: agentId }, // only properties this agent owns
        select: "title price images",
      })
      .populate("participants", "username email avatar")
      .populate({
        path: "lastMessage",
        populate: { path: "sender", select: "username email avatar" },
      })
      .sort({ updatedAt: -1 });

    // Filter out chats where the property didn't match (i.e., agent not owner)
    const filteredChats = chats.filter((chat) => chat.property !== null);

    res.json(filteredChats);
  } catch (error) {
    console.error("Get agent chats error:", error);
    res.status(500).json({ message: error.message });
  }
};

// ==========================
// 4. Get all chats
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
  getChatById,
  getAgentChats,
  getAllChats,
  deleteChat,
};
