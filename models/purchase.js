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

    // --- ITEM 18: Platform Fee Recorded per Purchase ---
    platformFee: { type: Number, default: 0 },
    // ---------------------------------------------------

    // 🔑 Paystack reference
    reference: {
      type: String,
      unique: true,
    },
    feePaid: { type: Boolean, default: false }, // buyer has paid
    feeReleased: { type: Boolean, default: false }, // payment released to owner
    escrowHeldBy: { type: Schema.Types.ObjectId, ref: "User" }, // admin holding payment
    status: {
      type: String,
      enum: [
        "none",
        "property_payment_review", // 🕒 Paystack confirmed, waiting for admin approval
        "property_payment_made",
        "handover_requested",
        "handover_scheduled",
        "handover_rescheduled",
        "handover_confirmed",
        "handover_completed",
        "funds_released",
        "purchase_cancelled",
      ],
      default: "none",
    },
    scheduledDate: { type: Date, default: Date.now },
    initializedAt: { type: Date },
    paystackPaidAt: { type: Date }, // 🕒 Track exact moment Paystack confirmed payment
    paidAt: { type: Date },
    scheduledAt: { type: Date },
    confirmedAt: { type: Date },
    completedAt: { type: Date },
  },
  { timestamps: true },
);

module.exports = mongoose.model("Purchase", PurchaseSchema);
