const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const PropertySchema = new Schema({
  title: { type: String, required: true },
  description: String,
  price: Number,
  address: String,
  images: [String], // cloudinary URLs
  video: String, // cloudinary URL
  owner: { type: Schema.Types.ObjectId, ref: "User" },
  status: {
    type: String,
    enum: ["available", "sold", "rented"],
    default: "available",
  },
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("Property", PropertySchema);
