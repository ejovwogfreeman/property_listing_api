const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const ChatSchema = new Schema(
  {
    participants: [
      { type: Schema.Types.ObjectId, ref: "User", required: true },
    ],

    // FIXED: store the last message as a reference
    lastMessage: {
      type: Schema.Types.ObjectId,
      ref: "Message",
    },
  },
  { timestamps: true }
);

/**
 * IMPORTANT FIX:
 * Sort participants before saving.
 * This ensures [A, B] and [B, A] become identical → unique index works properly.
 */
ChatSchema.pre("save", function (next) {
  if (this.participants && Array.isArray(this.participants)) {
    this.participants = this.participants
      .map((id) => id.toString())
      .sort()
      .map((id) => mongoose.Types.ObjectId(id));
  }
  next();
});

// UNIQUE CHAT ENFORCEMENT (now works correctly!)
ChatSchema.index({ participants: 1 }, { unique: true });

module.exports = mongoose.model("Chat", ChatSchema);
