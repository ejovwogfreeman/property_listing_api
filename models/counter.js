const mongoose = require("mongoose");

// One document per sequence, e.g. { _id: "property", seq: 42 }.
// $inc on this is atomic, so two requests can never get the same number.
const counterSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  seq: { type: Number, default: 0 },
});

module.exports =
  mongoose.models.Counter || mongoose.model("Counter", counterSchema);
