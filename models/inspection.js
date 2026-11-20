const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const InspectionSchema = new Schema(
  {
    property: { type: Schema.Types.ObjectId, ref: "Property", required: true },
    owner: { type: Schema.Types.ObjectId, ref: "User", required: true }, // property owner
    user: { type: Schema.Types.ObjectId, ref: "User", required: true }, // person requesting inspection
    code: { type: String, required: true },
    status: {
      type: String,
      enum: [
        "none",
        "inspection_requested", // 1. User submits the request
        "inspection_initialized", // 2. User starts the payment process
        "inspection_payment_review", // 3. Paystack confirmed, waiting for admin approval
        "inspection_paid", // 4. Payment is verified & escrow created
        "inspection_scheduled", // 5. Date/time for inspection is set
        "inspection_confirmed", // 6. Owner/Admin confirms the appointment
        "inspection_completed", // 7. Inspection has successfully taken place
        "inspection_cancelled", // 8. Cancelled / rejected
      ],
      default: "none",
    },
    fee: { type: Number, required: true },

    // --- Platform Fee Recorded per Inspection ---
    platformFee: { type: Number, default: 0 },
    // --------------------------------------------

    // 🔑 Paystack reference
    reference: {
      type: String,
      unique: true,
      sparse: true,
    },
    escrowHeldBy: { type: Schema.Types.ObjectId, ref: "User" }, // admin
    feePaid: { type: Boolean, default: false },
    feeReleased: { type: Boolean, default: false },

    // --- Refund & Mismatch Audit Fields ---
    refundDue: { type: Boolean, default: false },
    refundAmount: { type: Number, default: 0 },
    refundSentAt: { type: Date },
    refundSentAmount: { type: Number },
    refundReference: { type: String },
    refundNote: { type: String, default: null },
    refundProcessingFee: { type: Number, default: 0 },
    amountMismatch: { type: Boolean, default: false },
    paidAmount: { type: Number },
    // --------------------------------------

    scheduledDate: { type: Date, default: Date.now },
    initializedAt: { type: Date },
    paystackPaidAt: { type: Date }, // 🕒 Track exact moment Paystack confirmed payment
    paidAt: { type: Date },
    scheduledAt: { type: Date },
    confirmedAt: { type: Date },
    completedAt: { type: Date },
    feeReleasedAt: { type: Date },
    cancelledAt: { type: Date },
    // why it was cancelled: "property_taken" when another buyer secured the
    // property. those refunds carry no processing fee
    cancelReason: { type: String, default: null },
  },
  { timestamps: true },
);

module.exports = mongoose.model("Inspection", InspectionSchema);
