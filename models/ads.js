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

    // --- ADDED FOR ITEM 19: Start & End Dates ---
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    // ---------------------------------------------

    status: {
      type: String,
      enum: [
        "pending",
        "approved",
        "rejected",
        "active",
        "completed",
        "paused",
        // ended early: property secured, rejected, flagged or deleted, or an admin stopped it
        "stopped",
      ], // "pending" & "approved" are only on ads from before pay-at-launch
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
    // --- pay-at-launch: the running clock (see middlewares/adBilling.js) ---
    // paid run time not used yet, in ms; counts down while the ad runs
    remainingMs: { type: Number, default: 0 },
    // when the clock last started; null while paused or ended
    runningSince: { type: Date, default: null },
    // what the agent paid, by source (a resume adds to these)
    paidFromCredit: { type: Number, default: 0 },
    paidFromWallet: { type: Number, default: 0 },
    endedAt: { type: Date, default: null },
    // why it stopped early: property_secured, property_rejected,
    // property_flagged, property_deleted or admin
    stopReason: { type: String, default: null },
  },
  {
    timestamps: true, // Automatically manages createdAt and updatedAt fields
  },
);

module.exports = mongoose.model("Ad", AdSchema);
