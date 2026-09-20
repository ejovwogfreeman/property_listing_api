const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const EscrowSchema = new Schema({
  property: { type: Schema.Types.ObjectId, ref: "Property" },
  buyer: { type: Schema.Types.ObjectId, ref: "User" },
  seller: { type: Schema.Types.ObjectId, ref: "User" },
  amount: Number,
  status: {
    type: String,
    enum: ["on_hold", "released"],
    default: "on_hold",
  },
  type: String,
  reference: String,
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("Escrow", EscrowSchema);
