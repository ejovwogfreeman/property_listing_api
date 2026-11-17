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
    // 👈 ADD THIS FIELD TO YOUR SCHEMA
    rejectionReason: {
      type: String,
      default: null,
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
  if (!this.code) {
    let isUnique = false;
    let attempts = 0;

    while (!isUnique && attempts < 5) {
      attempts++;
      try {
        // Find the property with the highest code matching PROP-XXXX format
        const lastProperty = await mongoose
          .model("Property")
          .findOne({ code: /^PROP-\d+$/ })
          .sort({ createdAt: -1 });

        let nextNumber = 1;
        if (lastProperty && lastProperty.code) {
          const parts = lastProperty.code.split("-");
          const parsed = parseInt(parts[1], 10);
          if (!isNaN(parsed)) {
            nextNumber = parsed + 1;
          }
        }

        const candidateCode = `PROP-${String(nextNumber).padStart(4, "0")}`;

        // Check if it genuinely exists (handles legacy records without codes)
        const existing = await mongoose
          .model("Property")
          .findOne({ code: candidateCode });
        if (!existing) {
          this.code = candidateCode;
          isUnique = true;
        } else {
          // If collision happened due to concurrent requests, increment further or fallback to random suffix
          nextNumber += attempts;
        }
      } catch (err) {
        if (attempts >= 5) {
          // Fallback to random unique code if sequence gets stuck
          this.code = `PROP-${Math.floor(1000 + Math.random() * 9000)}`;
          isUnique = true;
        }
      }
    }
  }
  next();
});

module.exports = mongoose.model("Property", propertySchema);
