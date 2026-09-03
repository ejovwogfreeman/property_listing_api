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
        "inspection_paid", // 3. Payment is verified & escrow created
        "inspection_scheduled", // 4. Date/time for inspection is set
        "inspection_confirmed", // 5. Owner/Admin confirms the appointment
        "inspection_completed", // 6. Inspection has successfully taken place
        "inspection_cancelled", // (Good to have just in case)
      ],
      default: "none",
    },
    fee: { type: Number, required: true },
    escrowHeldBy: { type: Schema.Types.ObjectId, ref: "User" }, // admin
    feePaid: { type: Boolean, default: false },
    feeReleased: { type: Boolean, default: false }, // add this
    scheduledDate: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

module.exports = mongoose.model("Inspection", InspectionSchema);
