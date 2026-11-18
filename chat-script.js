// One-off: fill in participantsKey on old chats, drop the old array index,
// then build the new { participantsKey, property } unique index.
// Run once with: node scripts/fix-chat-index.js
require("dotenv").config();
const mongoose = require("mongoose");
const Chat = require("./models/chat");

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  console.log("Connected");

  // 1. fill in participantsKey on chats created before the field existed
  const chats = await Chat.find({
    $or: [{ participantsKey: { $exists: false } }, { participantsKey: null }],
  }).lean();

  for (const chat of chats) {
    const key = chat.participants
      .map((id) => id.toString())
      .sort()
      .join("_");
    await Chat.collection.updateOne(
      { _id: chat._id },
      { $set: { participantsKey: key } },
    );
  }
  console.log(`Filled participantsKey on ${chats.length} chats`);

  // 2. drop the old index (it blocks a second buyer from chatting with the same agent about the same property)
  const indexes = await Chat.collection.indexes();
  if (indexes.some((i) => i.name === "participants_1_property_1")) {
    await Chat.collection.dropIndex("participants_1_property_1");
    console.log("Dropped participants_1_property_1");
  } else {
    console.log("participants_1_property_1 was already gone");
  }

  // 3. build the indexes defined in models/chat.js
  await Chat.syncIndexes();
  console.log(
    "Indexes now:",
    (await Chat.collection.indexes()).map((i) => i.name),
  );

  await mongoose.disconnect();
  console.log("Done");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
