// scripts/oneTimeChatCleanup.js
require("dotenv").config();
const mongoose = require("mongoose");
const Chat = require("../models/chat");
const Message = require("../models/message");

const runOneTimeMigration = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("Connected to database...");

    // 1. Delete existing empty chats (lastMessage is null or missing)
    const emptyChatResult = await Chat.deleteMany({
      $or: [{ lastMessage: null }, { lastMessage: { $exists: false } }],
    });
    console.log(`Deleted ${emptyChatResult.deletedCount} empty chat(s).`);

    // 2. Mark all existing messages before deployment as read by both participants
    const cutoffDate = new Date();
    const chats = await Chat.find({}, "_id participants");

    let totalMessagesUpdated = 0;
    for (const chat of chats) {
      if (!chat.participants || chat.participants.length === 0) continue;

      const msgResult = await Message.updateMany(
        {
          chat: chat._id,
          createdAt: { $lte: cutoffDate },
        },
        {
          $addToSet: { readBy: { $each: chat.participants } },
        },
      );
      totalMessagesUpdated += msgResult.modifiedCount;
    }

    console.log(
      `Marked ${totalMessagesUpdated} pre-deployment message(s) as read by all chat participants.`,
    );
  } catch (err) {
    console.error("Migration failed:", err);
  } finally {
    await mongoose.disconnect();
    console.log("Disconnected. You can now delete this script.");
    process.exit(0);
  }
};

runOneTimeMigration();
