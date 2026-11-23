const bcrypt = require("bcryptjs");
const User = require("../models/user");
const Notification = require("../models/notification");

// wrong PINs in a row before withdrawals are locked, and for how long
const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 30;

const minutesLeft = (until) =>
  Math.max(1, Math.ceil((new Date(until).getTime() - Date.now()) / 60000));

/**
 * @desc Runs before a withdrawal: the agent must send their 4-digit
 * withdrawal PIN as `pin`. Every refusal carries a `code` the app reads:
 *   PIN_NOT_SET   - no PIN yet (403)
 *   PIN_LOCKED    - too many wrong PINs, try later or reset it (423)
 *   PIN_REQUIRED  - no PIN, or not 4 digits (400)
 *   PIN_INCORRECT - wrong PIN, with attemptsLeft (400)
 */
const requireWithdrawalPin = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id).select(
      "+withdrawalPin +pinAttempts",
    );
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    if (!user.withdrawalPin) {
      return res.status(403).json({
        success: false,
        code: "PIN_NOT_SET",
        message: "Set a withdrawal PIN before you withdraw.",
      });
    }

    if (user.pinLockedUntil && user.pinLockedUntil > new Date()) {
      return res.status(423).json({
        success: false,
        code: "PIN_LOCKED",
        lockedUntil: user.pinLockedUntil,
        message: `Too many wrong PINs. Try again in ${minutesLeft(user.pinLockedUntil)} minute(s), or reset your PIN.`,
      });
    }

    const pin = String(req.body.pin ?? "").trim();
    if (!/^\d{4}$/.test(pin)) {
      return res.status(400).json({
        success: false,
        code: "PIN_REQUIRED",
        message: "Enter your 4-digit withdrawal PIN.",
      });
    }

    const correct = await bcrypt.compare(pin, user.withdrawalPin);

    if (!correct) {
      const attempts = (user.pinAttempts || 0) + 1;

      if (attempts >= MAX_ATTEMPTS) {
        const lockedUntil = new Date(Date.now() + LOCK_MINUTES * 60000);
        await User.updateOne(
          { _id: user._id },
          { $set: { pinAttempts: 0, pinLockedUntil: lockedUntil } },
        );
        // tell the agent, in case it wasn't them
        await Notification.create({
          user: user._id,
          title: "Withdrawals locked",
          message: `Your withdrawal PIN was entered wrongly ${MAX_ATTEMPTS} times, so withdrawals are locked for ${LOCK_MINUTES} minutes. If this wasn't you, reset your PIN.`,
        });
        return res.status(423).json({
          success: false,
          code: "PIN_LOCKED",
          lockedUntil,
          message: `Too many wrong PINs. Withdrawals are locked for ${LOCK_MINUTES} minutes, or until you reset your PIN.`,
        });
      }

      await User.updateOne(
        { _id: user._id },
        { $set: { pinAttempts: attempts } },
      );
      const attemptsLeft = MAX_ATTEMPTS - attempts;
      return res.status(400).json({
        success: false,
        code: "PIN_INCORRECT",
        attemptsLeft,
        message: `Wrong PIN. ${attemptsLeft} attempt${attemptsLeft === 1 ? "" : "s"} left.`,
      });
    }

    // right PIN: start counting from zero again
    if (user.pinAttempts || user.pinLockedUntil) {
      await User.updateOne(
        { _id: user._id },
        { $set: { pinAttempts: 0, pinLockedUntil: null } },
      );
    }

    // the PIN isn't needed past this point
    delete req.body.pin;
    next();
  } catch (err) {
    console.error("requireWithdrawalPin error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

module.exports = { requireWithdrawalPin };
