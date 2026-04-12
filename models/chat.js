const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const ChatSchema = new Schema(
  {
    participants: [
      {
        type: Schema.Types.ObjectId,
        ref: "User",
        required: true,
      },
    ],

    // property-based chat
    property: {
      type: Schema.Types.ObjectId,
      ref: "Property",
      required: true,
    },

    lastMessage: {
      type: Schema.Types.ObjectId,
      ref: "Message",
    },
  },
  { timestamps: true },
);

/**
 * Sort participants before saving
 * Ensures [A, B] === [B, A]
 */
ChatSchema.pre("save", function (next) {
  if (this.participants && Array.isArray(this.participants)) {
    this.participants = this.participants
      .map((id) => id.toString())
      .sort()
      .map((id) => new mongoose.Types.ObjectId(id));
  }
  next();
});

/**
 * Ensure only 2 participants (user ↔ agent)
 */
ChatSchema.path("participants").validate(function (val) {
  return val.length === 2;
}, "Chat must have exactly 2 participants");

/**
 * Unique chat per (participants + property)
 */
ChatSchema.index({ participants: 1, property: 1 }, { unique: true });

module.exports = mongoose.models.Chat || mongoose.model("Chat", ChatSchema);
