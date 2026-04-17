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

    // 🧾 Only two allowed types
    type: {
      type: String,
      enum: ["wallet_funding", "agent_payment"],
      required: true,
    },

    // 📊 Payment status
    status: {
      type: String,
      enum: ["pending", "approved", "failed"],
      default: "pending",
    },

    // ⏱️ When payment was confirmed
    approvedAt: {
      type: Date,
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model("Transaction", TransactionSchema);
