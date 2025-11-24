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
      enum: ["pending", "verified", "expired"],
      default: "pending",
    },
    fee: { type: Number, required: true },
    escrowHeldBy: { type: Schema.Types.ObjectId, ref: "User" }, // admin
    feePaid: { type: Boolean, default: false },
    feeReleased: { type: Boolean, default: false }, // add this
    scheduledDate: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Inspection", InspectionSchema);
