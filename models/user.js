const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const UserSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  isGoogleUser: { type: Boolean, default: false },
  role: { type: String, enum: ["user", "agent", "admin"], default: "user" },

  // --- BUG 11: Agent Risk Level ---
  riskLevel: {
    type: String,
    enum: ["none", "low", "medium", "high"],
    default: "none",
  },

  // --- ITEM 15: Agent Verification Status ---
  verificationStatus: {
    type: String,
    enum: ["none", "pending", "approved", "rejected"],
    default: "none",
  },

  // --- ITEM 16: Suspend, Ban, and Flag on Users ---
  isSuspended: { type: Boolean, default: false },
  isBanned: { type: Boolean, default: false },
  isFlagged: { type: Boolean, default: false },

  // --- ITEM 17: Last-Active Time on Users ---
  lastActive: { type: Date, default: Date.now },

  verificationCode: { type: Number, default: false },
  isOnboarding: { type: Boolean, default: false },
  isVerified: { type: Boolean, default: false },
  onboardedAt: { type: Date, default: null },
  verificationNote: {
    type: String,
    trim: true,
  },
  rating: {
    type: Number,
    default: 0,
  },
  totalListings: {
    type: Number,
    default: 0,
  },
  balance: { type: Number, default: 0 },
  // money for ads only: the unused days of paused or stopped ads. Spent on
  // the next ad before the wallet; never withdrawn
  adCredit: { type: Number, default: 0 },

  // --- Withdrawal PIN (agents) ---
  // A 4-digit PIN asked for on every withdrawal. Only a bcrypt hash is kept,
  // and select: false keeps it (and the fields below marked so) out of every
  // response, including /user/me and the admin user lists.
  withdrawalPin: { type: String, default: null, select: false },
  // what the app reads to know whether a PIN has been set
  withdrawalPinSet: { type: Boolean, default: false },
  // wrong PINs in a row; 5 locks withdrawals until pinLockedUntil
  pinAttempts: { type: Number, default: 0, select: false },
  pinLockedUntil: { type: Date, default: null },
  // the emailed 6-digit code that sets or resets the PIN (a bcrypt hash too)
  pinCode: { type: String, default: null, select: false },
  pinCodeExpires: { type: Date, default: null, select: false },
  pinCodeSentAt: { type: Date, default: null, select: false },
  pinCodeAttempts: { type: Number, default: 0, select: false },
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
  licenseNumber: { type: String, default: null },
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
