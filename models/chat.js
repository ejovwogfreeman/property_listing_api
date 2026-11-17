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

    // 🔑 Sorted participant key to enforce unique conversations per pair + property
    participantsKey: {
      type: String,
      required: true,
    },

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
 * Sort participants and compute participantsKey before validating/saving
 * Ensures [A, B] === [B, A]
 */
ChatSchema.pre("validate", function (next) {
  if (this.participants && Array.isArray(this.participants)) {
    // Convert to strings, sort uniquely/consistently
    const sortedIds = this.participants.map((id) => id.toString()).sort();

    this.participants = sortedIds.map((id) => new mongoose.Types.ObjectId(id));
    this.participantsKey = sortedIds.join("_");
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
 * Unique chat per (participantsKey + property) string combination
 * Replaces the buggy array index { participants: 1, property: 1 }
 */
ChatSchema.index({ participantsKey: 1, property: 1 }, { unique: true });

module.exports = mongoose.models.Chat || mongoose.model("Chat", ChatSchema);
