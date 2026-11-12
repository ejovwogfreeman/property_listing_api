const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const NotificationSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    title: { type: String }, // 📌 Added to store notification titles
    type: { type: String },
    message: { type: String, required: true },
    data: { type: Object }, // Kept for backward compatibility
    meta: { type: Schema.Types.Mixed }, // 📌 Added to store metadata objects (e.g., escrowId, purchaseId)
    read: { type: Boolean, default: false },
  },
  { timestamps: true }, // Automatically handles createdAt and updatedAt
);

module.exports = mongoose.model("Notification", NotificationSchema);
