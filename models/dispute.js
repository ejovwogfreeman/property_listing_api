const mongoose = require("mongoose");
const Schema = mongoose.Schema;

// 💬 Sub-schema for chat/message history inside the dispute
const MessageSchema = new Schema(
  {
    sender: { type: Schema.Types.ObjectId, ref: "User", required: true },
    message: { type: String, required: true, trim: true },
  },
  { timestamps: true }, // Automatically tracks when each message was sent
);

const DisputeSchema = new Schema(
  {
    property: { type: Schema.Types.ObjectId, ref: "Property", required: true },
    user: { type: Schema.Types.ObjectId, ref: "User", required: true }, // The User/Client opening the dispute
    agent: { type: Schema.Types.ObjectId, ref: "User", required: true }, // The Agent being disputed against
    admin: { type: Schema.Types.ObjectId, ref: "User" }, // The Admin assigned to manage/moderate the dispute
    purchase: { type: Schema.Types.ObjectId, ref: "Purchase" }, // Optional linked purchase
    inspection: { type: Schema.Types.ObjectId, ref: "Inspection" }, // Optional linked inspection
    description: {
      type: String,
      required: [true, "Dispute description is required"],
      trim: true,
      maxlength: [2000, "Description cannot exceed 2000 characters"],
    },
    messages: [MessageSchema], // 📩 Back-and-forth communication thread
    resolutionNotes: { type: String, trim: true }, // Admin notes on how it was solved
    resolvedBy: { type: Schema.Types.ObjectId, ref: "User" }, // Admin who finally resolved it
    status: {
      type: String,
      enum: ["opened", "under_review", "resolved", "closed", "escalated"],
      default: "opened",
    },
    openedAt: { type: Date, default: Date.now },
    reviewedAt: { type: Date },
    resolvedAt: { type: Date },
    closedAt: { type: Date },
  },
  { timestamps: true },
);

module.exports = mongoose.model("Dispute", DisputeSchema);
