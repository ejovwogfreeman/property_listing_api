const mongoose = require("mongoose");

const AdSchema = new mongoose.Schema({
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
    enum: ["pending", "active", "completed", "rejected"],
    default: "pending",
  },
  isPaid: { type: Boolean, default: false },
  paymentReference: { type: String, default: null },
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("Ad", AdSchema);
