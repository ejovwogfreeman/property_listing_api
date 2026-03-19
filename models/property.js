// const mongoose = require("mongoose");
// const Schema = mongoose.Schema;

// const PropertySchema = new Schema({
//   title: { type: String, required: true },
//   description: String,
//   price: Number,
//   inspectionFee: Number,
//   address: String,
//   images: [String], // cloudinary URLs
//   video: String, // cloudinary URL
//   owner: { type: Schema.Types.ObjectId, ref: "User" },
//   status: {
//     type: String,
//     enum: ["available", "sold", "rented"],
//     default: "available",
//   },
//   createdAt: { type: Date, default: Date.now },
// });

// module.exports = mongoose.model("Property", PropertySchema);

// // please remember to write a controller function where property status can be set to pending, available, sold, rented etc

const mongoose = require("mongoose");

const propertySchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
    },
    price: {
      type: Number,
      required: true,
    },
    address: {
      type: String,
      required: true,
    },
    images: {
      type: [String],
      default: [],
    },
    video: {
      type: String,
    },
    propertyType: {
      type: String,
      required: true,
      enum: ["land", "apartment", "duplex", "bungalow"],
      // Helps differentiate land vs apartment/house
    },
    landType: {
      type: String,
      // Land-only field
    },
    bedroom: {
      type: Number,
      // Apartment/house-only field
    },
    bathroom: {
      type: Number,
      // Apartment/house-only field
    },
    kitchen: {
      type: Number,
      // Apartment/house-only field
    },
    description: {
      type: String,
    },
    inspectionFee: {
      type: Number,
    },
    serviceCharge: {
      type: Number,
    },
    nearbyPlaces: {
      type: [String],
      default: [],
    },
    owner: {
      _id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User", // or 'Agent' depending on your system
        required: true,
      },
      name: {
        type: String,
        required: true,
      },
      profilePicture: {
        type: String,
      },
      is_verified: {
        type: Boolean,
        default: false,
      },
      rating: {
        type: Number,
        default: 0,
      },
      totalListings: {
        type: Number,
        default: 0,
      },
    },
  },
  { timestamps: true }, // Automatically adds createdAt and updatedAt
);

module.exports = mongoose.model("Property", propertySchema);
