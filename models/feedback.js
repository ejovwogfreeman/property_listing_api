const mongoose = require("mongoose");

const feedbackSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: false, // Optional if submitted by a logged-in user
    },
    name: {
      type: String,
      required: false, // Optional fallback name
    },
    email: {
      type: String,
      required: false, // Optional fallback name
    },
    about: {
      type: String,
      required: true,
    },
    feedback: {
      type: String,
      required: true,
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model("Feedback", feedbackSchema);
