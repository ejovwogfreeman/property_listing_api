const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const ChatSchema = new Schema(
  {
    participants: [
      { type: Schema.Types.ObjectId, ref: "User", required: true },
    ],
    lastMessage: { type: String },
    updatedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

ChatSchema.index({ participants: 1 }, { unique: true });

module.exports = mongoose.model("Chat", ChatSchema);
