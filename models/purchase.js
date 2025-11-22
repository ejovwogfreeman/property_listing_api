const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const PurchaseSchema = new Schema(
  {
    property: { type: Schema.Types.ObjectId, ref: "Property", required: true },
    buyer: { type: Schema.Types.ObjectId, ref: "User", required: true },
    owner: { type: Schema.Types.ObjectId, ref: "User", required: true }, // property owner
    inspection: {
      type: Schema.Types.ObjectId,
      ref: "Inspection",
      required: true,
    },
    price: { type: Number, required: true },
    // code: { type: String }, // optional purchase code
    feePaid: { type: Boolean, default: false }, // buyer has paid
    feeReleased: { type: Boolean, default: false }, // payment released to owner
    escrowHeldBy: { type: Schema.Types.ObjectId, ref: "User" }, // admin holding payment
    status: {
      type: String,
      enum: ["pending", "paid", "completed", "cancelled"],
      default: "pending",
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Purchase", PurchaseSchema);
