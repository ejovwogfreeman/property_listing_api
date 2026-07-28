const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const UserSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  isGoogleUser: { type: Boolean, default: false },
  role: { type: String, enum: ["user", "agent", "admin"], default: "user" },
  verificationCode: { type: Number, default: false },
  isOnboarding: { type: Boolean, default: false },
  isVerified: { type: Boolean, default: false },
  rating: {
    type: Number,
    default: 0,
  },
  totalListings: {
    type: Number,
    default: 0,
  },
  balance: { type: Number, default: 0 },
  address: { type: String, default: null },
  phoneNumber: { type: String, default: null },
  profilePicture: {
    type: [String],
    default: [],
  },
  // Fields converted to camelCase
  about: { type: String, default: null },
  yearsOfExperience: { type: Number, default: 0 },
  serviceArea: { type: [String], default: [] },
  languages: { type: [String], default: [] },
  businessName: { type: String, default: null },
  licenceNumber: { type: String, default: null },
  officeAddress: { type: String, default: null },
  socialLinkOrWebsite: { type: String, default: null },
  governmentId: { type: [String], default: [] },
  licenseDoc: { type: [String], default: [] },
  createdAt: { type: Date, default: Date.now },
});

UserSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

UserSchema.methods.comparePassword = function (candidate) {
  return bcrypt.compare(candidate, this.password);
};

module.exports = mongoose.model("User", UserSchema);
