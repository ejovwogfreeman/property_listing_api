const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const UserSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  isGoogleUser: { type: Boolean, default: false },
  role: { type: String, enum: ["user", "agent", "admin"], default: "user" },
  verificationCode: { type: Number, default: false },
  isVerified: { type: Boolean, default: false },
  balance: { type: Number, default: 0 },
  address: { type: String, required: true },
  phoneNumber: { type: String, required: true },
  profilePicture: String,
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
