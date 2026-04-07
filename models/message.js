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

    text: {
      type: String,
      trim: true,
    },

    attachments: [{ type: String }],

    type: {
      type: String,
      enum: ["text", "image", "file"],
      default: "text",
    },

    readBy: [{ type: Schema.Types.ObjectId, ref: "User" }],
  },
  { timestamps: true },
);

// prevent empty messages
MessageSchema.pre("validate", function (next) {
  if (!this.text && (!this.attachments || this.attachments.length === 0)) {
    return next(new Error("Message cannot be empty"));
  }
  next();
});

// performance index
MessageSchema.index({ chat: 1, createdAt: 1 });

module.exports =
  mongoose.models.Message || mongoose.model("Message", MessageSchema);
