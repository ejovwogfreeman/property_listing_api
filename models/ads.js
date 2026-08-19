const mongoose = require("mongoose");

const AdSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    property: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Property",
      required: true,
    },
    objective: { type: String, required: true },
    dailyBudget: { type: Number, required: true },
    duration: { type: Number, required: true }, // duration in days
    adBudget: { type: Number, required: true }, // total budget (can be calculated or passed)
    status: {
      type: String,
      enum: ["pending", "active", "completed", "paused"],
      default: "pending",
    },
    isPaid: { type: Boolean, default: false },
    paymentReference: { type: String, default: null },

    // Performance Metrics
    views: { type: Number, default: 0 },
    clicks: { type: Number, default: 0 },
    spent: { type: Number, default: 0 },
    ctr: { type: Number, default: 0 }, // Click-Through Rate (e.g., percentage)
    pauseReason: { type: String, default: null },
  },
  {
    timestamps: true, // Automatically manages createdAt and updatedAt fields
  },
);

module.exports = mongoose.model("Ad", AdSchema);
