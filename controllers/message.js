// controllers/messageController.js
const Message = require("../models/Message");
const Chat = require("../models/Chat");
const { uploadImages, uploadVideos } = require("../middlewares/cloudinary");

// ==========================
// SEND MESSAGE
// ==========================
sendMessage = async (req, res) => {
  try {
    const { chatId, text } = req.body;
    const sender = req.user._id;

    if (!chatId) {
      return res.status(400).json({ message: "chatId is required" });
    }

    if (!text && !req.files?.images && !req.files?.videos) {
      return res.status(400).json({ message: "Message cannot be empty" });
    }

    // ---- FILES ----
    const images = req.files?.images || [];
    const videos = req.files?.videos || [];

    let uploadedImages = [];
    let uploadedVideos = [];

    if (images.length > 0) {
      uploadedImages = await uploadImages(images, "chat/images");
    }

    if (videos.length > 0) {
      uploadedVideos = await uploadVideos(videos, "chat/videos");
    }

    // Combine all attachments into a single array
    const allAttachments = [...uploadedImages, ...uploadedVideos];

    // ---- MESSAGE DATA ----
    const messageData = {
      chat: chatId,
      sender,
      text: text || "",
      attachments: allAttachments,
    };

    // Save message
    const message = await Message.create(messageData);

    // Update chat.lastMessage
    const chat = await Chat.findByIdAndUpdate(
      chatId,
      { lastMessage: message._id, updatedAt: new Date() },
      { new: true }
    ).populate("participants", "username email avatar");

    // -----------------------------
    // Emit live notification via Socket.IO
    // -----------------------------
    // Find the other participant
    const otherUser = chat.participants.find(
      (user) => user._id.toString() !== sender.toString()
    );

    if (otherUser) {
      const targetSocket = global.onlineUsers.get(otherUser._id.toString());
      if (targetSocket) {
        global.io.to(targetSocket).emit("receive_message", message);
      }
    }

    return res.status(201).json({
      message: "Message sent successfully",
      data: message,
    });
  } catch (error) {
    console.error("Send message error:", error);
    return res.status(500).json({ message: "Error sending message", error });
  }
};

// ==========================
// GET ALL MESSAGES IN A CHAT
// ==========================
getMessages = async (req, res) => {
  try {
    const { chatId } = req.params;
    const { page = 1, limit = 30 } = req.query;

    const messages = await Message.find({ chat: chatId })
      .populate("sender", "username avatar email")
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    res.json(messages);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// ==========================
// UPDATE MESSAGE TEXT ONLY
// ==========================
updateMessage = async (req, res) => {
  try {
    const { messageId } = req.params;
    const { text } = req.body;
    const userId = req.user._id;

    if (!text || text.trim() === "") {
      return res.status(400).json({ message: "Message text cannot be empty" });
    }

    const message = await Message.findById(messageId);

    if (!message) {
      return res.status(404).json({ message: "Message not found" });
    }

    // Only sender can update
    if (message.sender.toString() !== userId.toString()) {
      return res
        .status(403)
        .json({ message: "Not allowed to update this message" });
    }

    // Update only text
    message.text = text;
    await message.save();

    const updatedMessage = await Message.findById(messageId).populate(
      "sender",
      "username avatar email"
    );

    res.json({
      message: "Message updated successfully",
      data: updatedMessage,
    });
  } catch (error) {
    console.error("Update message error:", error);
    res.status(500).json({ message: "Server error", error });
  }
};

// ==========================
// DELETE A MESSAGE
// ==========================
deleteMessage = async (req, res) => {
  try {
    const { messageId } = req.params;
    const userId = req.user._id;

    const message = await Message.findById(messageId);

    if (!message) {
      return res.status(404).json({ message: "Message not found" });
    }

    // Only sender can delete
    if (message.sender.toString() !== userId.toString()) {
      return res
        .status(403)
        .json({ message: "Not allowed to delete this message" });
    }

    await message.deleteOne();

    // If deleted message was chat.lastMessage, update chat
    const chat = await Chat.findById(message.chat);
    if (chat.lastMessage?.toString() === message._id.toString()) {
      const lastMsg = await Message.find({ chat: chat._id })
        .sort({ createdAt: -1 })
        .limit(1);

      chat.lastMessage = lastMsg[0]?._id || null;
      await chat.save();
    }

    res.json({ message: "Message deleted successfully" });
  } catch (error) {
    console.error("Delete message error:", error);
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  sendMessage,
  getMessages,
  updateMessage,
  deleteMessage,
};
