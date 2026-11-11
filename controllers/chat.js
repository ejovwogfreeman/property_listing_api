// controllers/chatController.js
const Chat = require("../models/chat");
const Message = require("../models/message");
const Property = require("../models/property");

// ==========================
// 0. One-Time Legacy Migration (Runs on startup)
// ==========================
// ==========================
// 0. One-Time Legacy Migration (Runs on startup)
// ==========================
const runMessageReadMigration = async () => {
  try {
    const result = await Message.updateMany(
      { $or: [{ readBy: { $exists: false } }, { readBy: { $size: 0 } }] },
      [
        { $set: { readBy: ["$sender"] } }, // 👈 Pipeline update syntax correctly references the sender field
      ],
    );
    if (result.modifiedCount > 0) {
      console.log(
        `[Migration] Marked ${result.modifiedCount} legacy messages as read.`,
      );
    }
  } catch (err) {
    console.error(
      "[Migration Error] Failed to mark legacy messages as read:",
      err,
    );
  }
};

// Execute migration immediately when the file loads
runMessageReadMigration();

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

    const property = await Property.findById(propertyId).populate("owner");

    if (!property) {
      return res.status(404).json({
        message: "Property not found",
      });
    }

    const ownerId = property.owner?._id
      ? property.owner._id.toString()
      : property.owner?.toString();
    if (ownerId !== agentId.toString()) {
      return res.status(400).json({
        message: "This property does not belong to this agent",
      });
    }

    const participants = [userId.toString(), agentId.toString()].sort();

    let chat = await Chat.findOne({
      property: propertyId,
      participants,
    });

    if (!chat) {
      try {
        chat = await Chat.create({
          participants,
          property: propertyId,
        });
      } catch (err) {
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
// 2. Get all chats for the logged-in user (With Unread Counts & Address)
// ==========================
const getUserChats = async (req, res) => {
  try {
    const userId = req.user._id;

    const chats = await Chat.find({
      participants: userId,
    })
      .populate(
        "participants",
        "username email phoneNumber profilePicture isVerified",
      )
      .populate("property", "title price images address")
      .populate({
        path: "lastMessage",
        populate: {
          path: "sender",
          select: "username email avatar",
        },
      })
      .sort({ updatedAt: -1 });

    const chatsWithUnread = await Promise.all(
      chats.map(async (chat) => {
        const chatObj = chat.toObject();

        const unreadCount = await Message.countDocuments({
          chat: chat._id,
          sender: { $ne: userId },
          readBy: { $ne: userId },
        });

        return {
          ...chatObj,
          unreadCount,
        };
      }),
    );

    return res.json(chatsWithUnread);
  } catch (error) {
    console.error("Get user chats error:", error);
    return res.status(500).json({ message: error.message });
  }
};

// ==========================
// 3. Get all chats (Admin view)
// ==========================
const getAllChats = async (req, res) => {
  try {
    const chats = await Chat.find()
      .populate(
        "participants",
        "username email phoneNumber profilePicture isVerified",
      )
      .populate("property", "title address price images")
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
// 4. Get a single chat by ID (With Address)
// ==========================
const getChatById = async (req, res) => {
  try {
    const chatId = req.params.chatId;
    const userId = req.user._id;

    const chat = await Chat.findById(chatId)
      .populate(
        "participants",
        "username email phoneNumber profilePicture isVerified",
      )
      .populate("property", "title price images address")
      .populate({
        path: "lastMessage",
        populate: { path: "sender", select: "username avatar" },
      });

    if (!chat) {
      return res.status(404).json({ message: "Chat not found" });
    }

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
