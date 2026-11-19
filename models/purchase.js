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
      required: false, // Optional if purchased directly or linked later
    },
    price: { type: Number, required: true },

    // --- Platform Fee Recorded per Purchase ---
    platformFee: { type: Number, default: 0 },
    // ------------------------------------------

    // 🔑 Paystack reference
    reference: {
      type: String,
      unique: true,
      sparse: true,
    },
    feePaid: { type: Boolean, default: false }, // buyer has paid
    feeReleased: { type: Boolean, default: false }, // payment released to owner
    escrowHeldBy: { type: Schema.Types.ObjectId, ref: "User" }, // admin holding payment

    // --- Property Lock & Audit Fields ---
    holdsProperty: { type: Boolean, default: false },

    refundDue: { type: Boolean, default: false },
    refundAmount: { type: Number, default: 0 },
    refundSentAt: { type: Date },
    refundSentAmount: { type: Number },
    refundReference: { type: String },
    refundNote: { type: String, default: null },
    refundProcessingFee: { type: Number, default: 0 },

    amountMismatch: { type: Boolean, default: false },
    paidAmount: { type: Number },
    // ------------------------------------

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

// Partial unique index to lock property against competing buyers when holdsProperty is true
PurchaseSchema.index(
  { property: 1 },
  { unique: true, partialFilterExpression: { holdsProperty: true } },
);

module.exports = mongoose.model("Purchase", PurchaseSchema);
