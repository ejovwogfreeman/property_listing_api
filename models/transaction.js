const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const TransactionSchema = new Schema(
  {
    // 👤 Who initiated the transaction (user or admin)
    from: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    // 👤 Who receives the money (user or agent)
    to: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },

    // 💰 Amount
    amount: {
      type: Number,
      required: true,
    },

    // 🔑 Paystack reference
    reference: {
      type: String,
      required: true,
      unique: true,
    },

    type: {
      type: String,
      enum: [
        "wallet_funding",
        "agent_payment",
        "withdrawal",
        "escrow_release",
        "escrow_refund",
      ],
      required: true,
    },
    status: {
      type: String,
      enum: ["pending", "approved", "declined", "failed", "completed"],
      default: "pending",
    },

    // --- Saved snapshot of bank details for withdrawals ---
    bankDetails: {
      bankName: { type: String },
      bankCode: { type: String },
      accountNumber: { type: String },
      accountName: { type: String },
    },
    // -----------------------------------------------------

    // ⏱️ When payment was confirmed
    approvedAt: {
      type: Date,
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model("Transaction", TransactionSchema);
