const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const RatingSchema = new Schema(
  {
    property: {
      type: Schema.Types.ObjectId,
      ref: "Property",
      required: true,
    },
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    }, // Client/Buyer leaving the review
    agent: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    }, // Agent managing the property
    inspection: {
      type: Schema.Types.ObjectId,
      ref: "Inspection",
    }, // Linked inspection record (optional, but one of the two is required)
    purchase: {
      type: Schema.Types.ObjectId,
      ref: "Purchase",
    }, // Linked purchase record (optional, but one of the two is required)
    rating: {
      type: Number,
      required: true,
      min: [1, "Rating must be at least 1"],
      max: [5, "Rating cannot exceed 5"],
    },
    comment: {
      type: String,
      trim: true,
      maxlength: [1000, "Comment cannot exceed 1000 characters"],
    },
  },
  { timestamps: true },
);

// 🛑 Custom validation to ensure EITHER inspection or purchase is provided
RatingSchema.pre("validate", function (next) {
  if (!this.inspection && !this.purchase) {
    return next(
      new Error(
        "You must have either completed an inspection or made a purchase to leave a review.",
      ),
    );
  }
  next();
});

// 🛑 Prevent a user from spamming multiple reviews on the same property
RatingSchema.index({ property: 1, user: 1 }, { unique: true });

module.exports = mongoose.model("Rating", RatingSchema);
