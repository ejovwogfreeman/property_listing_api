const mongoose = require("mongoose");

const bankSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true, // Ensures one active bank record per agent
    },
    bankName: {
      type: String,
      required: true,
      trim: true,
    },
    bankCode: {
      type: String,
      required: true,
      trim: true, // Needed if you want to keep track or use it for automated transfers later
    },
    accountNumber: {
      type: String,
      required: true,
      trim: true,
    },
    accountName: {
      type: String,
      required: true,
      trim: true, // Automatically populated/verified via Paystack
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model("Bank", bankSchema);
