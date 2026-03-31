const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const favoriteSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    property: { type: mongoose.Schema.Types.ObjectId, ref: "Property" },
  },
  { timestamps: true },
);

module.exports = mongoose.model("Favorite", favoriteSchema);
