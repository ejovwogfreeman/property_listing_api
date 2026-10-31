const mongoose = require("mongoose");

const propertySchema = new mongoose.Schema(
  {
    code: {
      type: String,
      unique: true,
      sparse: true,
    },
    title: {
      type: String,
      required: true,
    },
    price: {
      type: Number,
      required: true,
    },
    escrowFee: {
      type: Number,
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
    },
    listingType: {
      type: String,
      required: true,
      enum: ["rent", "sale"],
    },
    landSize: {
      type: String,
    },
    landUnit: {
      type: String,
      enum: ["sqm", "acres", "hectares"],
    },
    landCondition: {
      type: String,
      enum: ["bare land", "fenced land", "land with structure"],
    },
    landDocTitle: {
      type: String,
      enum: [
        "Certificate of Ownership",
        "Governor's Consent",
        "Deed of Assignment",
      ],
    },
    landType: {
      type: String,
      enum: ["residential", "commercial", "agriculture"],
    },
    legalDocuments: {
      type: [String],
      default: [],
    },
    bedroom: {
      type: Number,
    },
    bathroom: {
      type: Number,
    },
    kitchen: {
      type: Number,
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
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
    },
    // --- BUG 8: Flagging Fields ---
    isFlagged: {
      type: Boolean,
      default: false,
    },
    flagReason: {
      type: String,
      default: null,
    },
    flaggedAt: {
      type: Date,
      default: null,
    },
    // --- BUG 9: Admin Notes ---
    adminNotes: [
      {
        note: { type: String, required: true },
        author: {
          _id: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
          name: { type: String },
        },
        createdAt: { type: Date, default: Date.now },
      },
    ],
    // --- BUG 10: Status History ---
    statusHistory: [
      {
        status: { type: String, required: true },
        at: { type: Date, default: Date.now },
        by: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      },
    ],
    owner: {
      _id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
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
  { timestamps: true },
);

// --- PRE-SAVE HOOK: Auto-generate Code & Track Status History ---
propertySchema.pre("save", async function (next) {
  // Generate human-readable code if it doesn't exist (Bug 12)
  if (!this.code) {
    const count = await mongoose.model("Property").countDocuments();
    this.code = `PROP-${String(count + 1).padStart(4, "0")}`;
  }

  // If status is modified or it's a new document, push to status history (Bug 10)
  if (this.isNew || this.isModified("status")) {
    this.statusHistory.push({
      status: this.status,
      at: new Date(),
      by: this.owner._id, // defaults to owner on creation, or can be overwritten in controllers during admin actions
    });
  }

  next();
});

module.exports = mongoose.model("Property", propertySchema);
