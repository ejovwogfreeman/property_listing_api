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
    videos: {
      type: [String],
      default: [],
    },
    propertyType: {
      type: String,
      required: true,
      enum: ["land", "apartment", "duplex", "bungalow"],
      // Helps differentiate land vs apartment/house
    },
    listingType: {
      type: String,
      required: true,
      enum: ["rent", "sale"],
      // Helps differentiate land vs apartment/house
    },
    landSize: {
      type: String,
      // Land-only field
    },
    landUnit: {
      type: String,
      required: true,
      enum: ["sqm", "acres", "hectares"],
    },
    landCondition: {
      type: String,
      required: true,
      enum: ["bare land", "fenced land", "land with structure"],
    },
    landDocTitle: {
      type: String,
      required: true,
      enum: [
        "Certificate of Ownership",
        "Governor's Consent",
        "Deed of Assignment",
      ],
    },
    landDocuments: {
      type: [String],
      default: [],
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
        type: [String],
        default: [],
      },
      isVerified: {
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
