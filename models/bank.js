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
    accountNumber: {
      type: String,
      required: true,
      trim: true,
    },
    accountName: {
      type: String,
      trim: true, // Optional: if you want to store the verified account holder name
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model("Bank", bankSchema);
