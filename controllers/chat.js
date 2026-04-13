// controllers/chatController.js
const Chat = require("../models/chat");
const Message = require("../models/message");

// ==========================
// 1. Create or Fetch a 1-on-1 Chat
// ==========================
const createOrGetChat = async (req, res) => {
  try {
    const { agentId, propertyId } = req.body;
    const userId = req.user._id; // logged-in user

    // 1️⃣ Validate inputs
    if (!agentId || !propertyId) {
      return res.status(400).json({
        message: "agentId and propertyId are required",
      });
    }

    // 2️⃣ Prevent self-chat
    if (userId.toString() === agentId.toString()) {
      return res.status(400).json({
        message: "You cannot chat with yourself",
      });
    }

    // 3️⃣ Prepare participants (sorted for consistency)
    const participants = [userId.toString(), agentId.toString()].sort();

    // 4️⃣ Check for existing chat (same 2 users + same property)
    let chat = await Chat.findOne({
      participants,
      property: propertyId,
    });

    // 5️⃣ If not found, create new chat
    if (!chat) {
      chat = await Chat.create({
        participants,
        property: propertyId,
      });
    }

    // 6️⃣ Return chat
    return res.status(200).json(chat);
  } catch (error) {
    console.error("Create/Get Chat Error:", error);
    return res.status(500).json({ message: error.message });
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
