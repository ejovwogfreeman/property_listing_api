const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const EscrowSchema = new Schema(
  {
    property: { type: Schema.Types.ObjectId, ref: "Property" },
    buyer: { type: Schema.Types.ObjectId, ref: "User" },
    seller: { type: Schema.Types.ObjectId, ref: "User" },
    purchase: { type: Schema.Types.ObjectId, ref: "Purchase", default: null },
    inspection: {
      type: Schema.Types.ObjectId,
      ref: "Inspection",
      default: null,
    },
    amount: Number,
    platformFee: { type: Number, default: 0 },
    netPayout: { type: Number, default: 0 }, // 🛡️ Added so purchase net payout isn't silently dropped
    status: {
      type: String,
      enum: ["on_hold", "released", "refunded"],
      default: "on_hold",
    },
    type: String,
    reference: String,
    // --- Audit fields added below ---
    releasedAt: { type: Date, default: null },
    releasedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    reason: { type: String, default: null },
  },
  { timestamps: true },
);

module.exports = mongoose.model("Escrow", EscrowSchema);
