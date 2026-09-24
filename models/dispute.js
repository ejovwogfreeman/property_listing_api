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
    referenceId: {
      type: String,
      unique: true,
      required: true,
      default: () => `DSP-${Math.floor(100000 + Math.random() * 900000)}`,
    },
    property: { type: Schema.Types.ObjectId, ref: "Property", required: true },
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    agent: { type: Schema.Types.ObjectId, ref: "User", required: true },
    admin: { type: Schema.Types.ObjectId, ref: "User" },
    purchase: { type: Schema.Types.ObjectId, ref: "Purchase" },
    inspection: { type: Schema.Types.ObjectId, ref: "Inspection" },
    category: {
      type: String,
      required: [true, "Dispute category is required"],
      enum: [
        "refund_request",
        "property_mismatch",
        "agent_misconduct",
        "payment_issue",
        "other",
      ],
      default: "other",
    },
    description: {
      type: String,
      required: [true, "Dispute description is required"],
      trim: true,
      maxlength: [2000, "Description cannot exceed 2000 characters"],
    },
    disputeFiles: [{ type: String }],
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

module.exports = {
  Dispute,
  DisputeMessage,
};
