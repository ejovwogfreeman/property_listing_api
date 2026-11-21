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
      enum: ["on_hold", "refund_pending", "released", "refunded"],
      default: "on_hold",
    },
    type: String,
    reference: String,

    // --- Audit fields for release & manual refunds ---
    releasedAt: { type: Date, default: null },
    releasedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },

    refundApprovedAt: { type: Date, default: null },
    refundApprovedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    refundedAt: { type: Date, default: null },
    refundedAmount: { type: Number, default: null },
    transferReference: { type: String, default: null },
    refundNote: { type: String, default: null },
    refundProcessingFee: { type: Number, default: 0 },
    // --- Paystack refunds (sent from the admin dashboard) ---
    // "manual": the admin sent a bank transfer and recorded it.
    // "paystack": refunded to the buyer's card/account through Paystack.
    refundMethod: {
      type: String,
      enum: ["manual", "paystack", null],
      default: null,
    },
    paystackRefundId: { type: String, default: null },
    // Paystack's own status: pending, processing, processed or failed
    paystackRefundStatus: { type: String, default: null },

    reason: { type: String, default: null },
    // no processing fee on this refund (e.g. the property was secured by
    // another buyer before the inspection)
    refundFeeWaived: { type: Boolean, default: false },
  },
  { timestamps: true },
);

module.exports = mongoose.model("Escrow", EscrowSchema);
