const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const MessageSchema = new Schema(
  {
    chat: {
      type: Schema.Types.ObjectId,
      ref: "Chat",
      required: true,
    },
    sender: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    text: { type: String },

    // Supports images/files
    attachments: [{ type: String }],
  },
  { timestamps: true }
);

// FIX: Prevent OverwriteModelError
module.exports =
  mongoose.models.Message || mongoose.model("Message", MessageSchema);
