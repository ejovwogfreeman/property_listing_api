const mongoose = require("mongoose");
const Schema = mongoose.Schema;

// -------------------------------------------
// 1️⃣ Dispute Message Schema
// -------------------------------------------
const DisputeMessageSchema = new Schema(
  {
    dispute: {
      type: Schema.Types.ObjectId,
      ref: "Dispute",
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
    attachments: [{ type: String }], // Unified array for images or documents
    type: {
      type: String,
      enum: ["text", "image", "file"],
      default: "text",
    },
    readBy: [{ type: Schema.Types.ObjectId, ref: "User" }],
  },
  { timestamps: true }, // Automatic timestamps for every message
);

// Prevent empty messages (must have text or attachments)
DisputeMessageSchema.pre("validate", function (next) {
  if (!this.text && (!this.attachments || this.attachments.length === 0)) {
    return next(new Error("Message cannot be empty"));
  }
  next();
});

DisputeMessageSchema.index({ dispute: 1, createdAt: 1 });

const DisputeMessage =
  mongoose.models.DisputeMessage ||
  mongoose.model("DisputeMessage", DisputeMessageSchema);

// -------------------------------------------
// 2️⃣ Main Dispute Ticket Schema
// -------------------------------------------
const DisputeSchema = new Schema(
  {
    property: { type: Schema.Types.ObjectId, ref: "Property", required: true },
    user: { type: Schema.Types.ObjectId, ref: "User", required: true }, // Client opening it
    agent: { type: Schema.Types.ObjectId, ref: "User", required: true }, // Agent being disputed
    admin: { type: Schema.Types.ObjectId, ref: "User" }, // Assigned admin
    purchase: { type: Schema.Types.ObjectId, ref: "Purchase" },
    inspection: { type: Schema.Types.ObjectId, ref: "Inspection" },
    description: {
      type: String,
      required: [true, "Dispute description is required"],
      trim: true,
      maxlength: [2000, "Description cannot exceed 2000 characters"],
    },
    disputeFiles: [{ type: String }], // Initial ticket files/images
    resolutionNotes: { type: String, trim: true },
    resolvedBy: { type: Schema.Types.ObjectId, ref: "User" },
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

const Dispute =
  mongoose.models.Dispute || mongoose.model("Dispute", DisputeSchema);

// Export both models from this single file
module.exports = {
  Dispute,
  DisputeMessage,
};
