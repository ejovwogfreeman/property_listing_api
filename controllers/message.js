const Message = require("../models/message");
const Chat = require("../models/chat");
const { uploadImages, uploadVideos } = require("../middlewares/cloudinary");

// ==========================
// SEND MESSAGE
// ==========================
const sendMessage = async (req, res) => {
  try {
    const { chatId, text } = req.body;
    const sender = req.user._id;

    if (!chatId) {
      return res.status(400).json({ message: "chatId is required" });
    }

    const chat = await Chat.findById(chatId).populate("participants");
    if (!chat) {
      return res.status(404).json({ message: "Chat not found" });
    }

    const isParticipant = chat.participants.some(
      (p) => p._id.toString() === sender.toString(),
    );

    if (!isParticipant) {
      return res.status(403).json({ message: "Access denied" });
    }

    if (!text && !req.files?.images && !req.files?.videos) {
      return res.status(400).json({ message: "Message cannot be empty" });
    }

    // =====================
    // FILE UPLOADS
    // =====================
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

    const allAttachments = [...uploadedImages, ...uploadedVideos];

    // =====================
    // CREATE MESSAGE
    // =====================
    const message = await Message.create({
      chat: chatId,
      sender,
      text: text || "",
      attachments: allAttachments,
      readBy: [sender], // Sender automatically reads their own message
    });

    // =====================
    // UPDATE LAST MESSAGE
    // =====================
    await Chat.findByIdAndUpdate(chatId, {
      lastMessage: message._id,
      updatedAt: new Date(),
    });

    const fullMessage = await Message.findById(message._id).populate(
      "sender",
      "name email avatar",
    );

    // =====================
    // SOCKET EMIT
    // =====================
    if (global.io) {
      chat.participants.forEach((user) => {
        const userId = user._id.toString();

        if (userId === sender.toString()) return;

        global.io.to(userId).emit("receive_message", fullMessage);
      });
    }

    return res.status(201).json({
      message: "Message sent successfully",
      data: fullMessage,
    });
  } catch (error) {
    console.error("Send message error:", error);
    return res.status(500).json({ message: "Error sending message" });
  }
};

// ==========================
// GET ALL MESSAGES IN A CHAT (Marks messages as read)
// ==========================
const getMessages = async (req, res) => {
  try {
    const { chatId } = req.params;
    const userId = req.user._id;

    const chat = await Chat.findById(chatId);
    if (!chat) {
      return res.status(404).json({ message: "Chat not found" });
    }

    if (!chat.participants.some((p) => p.toString() === userId.toString())) {
      return res.status(403).json({ message: "Access denied" });
    }

    // 🛡️ MARK UNREAD MESSAGES AS READ FOR LOGGED-IN USER
    await Message.updateMany(
      {
        chat: chatId,
        sender: { $ne: userId },
        readBy: { $ne: userId },
      },
      {
        $addToSet: { readBy: userId },
      },
    );

    // Fetch all messages in chronological order
    const messages = await Message.find({ chat: chatId })
      .populate("sender", "name avatar email")
      .sort({ createdAt: 1 }); // oldest first

    res.json(messages);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// ==========================
// UPDATE MESSAGE
// ==========================
const updateMessage = async (req, res) => {
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

    if (message.sender.toString() !== userId.toString()) {
      return res.status(403).json({ message: "Not allowed" });
    }

    message.text = text;
    await message.save();

    const updatedMessage = await Message.findById(messageId).populate(
      "sender",
      "name avatar email",
    );

    res.json({
      message: "Message updated successfully",
      data: updatedMessage,
    });
  } catch (error) {
    console.error("Update message error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

// ==========================
// DELETE MESSAGE
// ==========================
const deleteMessage = async (req, res) => {
  try {
    const { messageId } = req.params;
    const userId = req.user._id;

    const message = await Message.findById(messageId);

    if (!message) {
      return res.status(404).json({ message: "Message not found" });
    }

    if (message.sender.toString() !== userId.toString()) {
      return res.status(403).json({ message: "Not allowed" });
    }

    await message.deleteOne();

    // =====================
    // FIX LAST MESSAGE
    // =====================
    const chat = await Chat.findById(message.chat);

    if (chat && chat.lastMessage?.toString() === message._id.toString()) {
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
