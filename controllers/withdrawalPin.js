const bcrypt = require("bcryptjs");
const User = require("../models/user");
const Notification = require("../models/notification");
const Email = require("../middlewares/email");
const generateCode = require("../middlewares/generateCode");

// how long an emailed code works, how soon another can be sent, and how many
// wrong tries a code gets before a new one is needed
const CODE_MINUTES = 10;
const RESEND_SECONDS = 60;
const MAX_CODE_ATTEMPTS = 5;

// PINs anyone would try first: one digit four times, or a straight run
const isWeakPin = (pin) =>
  /^(\d)\1{3}$/.test(pin) ||
  "0123456789".includes(pin) ||
  "9876543210".includes(pin);

/**
 * @desc Email the agent a 6-digit code to set (or reset) their withdrawal PIN.
 * The same code is used the first time and when they've forgotten it, so
 * someone using an agent's open session can't set or change the PIN without
 * also having their email.
 */
const sendWithdrawalPinCode = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select("+pinCodeSentAt");
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    if (
      user.pinCodeSentAt &&
      Date.now() - new Date(user.pinCodeSentAt).getTime() <
        RESEND_SECONDS * 1000
    ) {
      return res.status(429).json({
        success: false,
        message: "Please wait a minute before asking for another code.",
      });
    }

    const code = generateCode();
    await User.updateOne(
      { _id: user._id },
      {
        $set: {
          pinCode: await bcrypt.hash(code, 10),
          pinCodeExpires: new Date(Date.now() + CODE_MINUTES * 60000),
          pinCodeSentAt: new Date(),
          pinCodeAttempts: 0,
        },
      },
    );

    await Email(user.email, "Your withdrawal PIN code", "withdrawalPin.html", {
      NAME: user.name || user.email,
      CODE: code,
      MINUTES: CODE_MINUTES,
    });

    return res.json({
      success: true,
      message: `We've sent a 6-digit code to ${user.email}. It works for ${CODE_MINUTES} minutes.`,
    });
  } catch (err) {
    console.error("sendWithdrawalPinCode error:", err);
    return res
      .status(500)
      .json({ success: false, message: "Couldn't send the code. Try again." });
  }
};

/**
 * @desc Set or reset the withdrawal PIN with the emailed code.
 * Body: { code: "123456", pin: "4826" }
 * Refusals carry a `code`: CODE_EXPIRED, CODE_INCORRECT, PIN_INVALID, PIN_WEAK.
 */
const setWithdrawalPin = async (req, res) => {
  try {
    const code = String(req.body.code ?? "").trim();
    const pin = String(req.body.pin ?? "").trim();

    if (!/^\d{4}$/.test(pin)) {
      return res.status(400).json({
        success: false,
        code: "PIN_INVALID",
        message: "Your PIN must be exactly 4 digits.",
      });
    }
    if (isWeakPin(pin)) {
      return res.status(400).json({
        success: false,
        code: "PIN_WEAK",
        message: "That PIN is too easy to guess. Avoid 1111 or 1234.",
      });
    }

    const user = await User.findById(req.user._id).select(
      "+withdrawalPin +pinCode +pinCodeExpires +pinCodeAttempts",
    );
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    const expired =
      !user.pinCode ||
      !user.pinCodeExpires ||
      user.pinCodeExpires < new Date() ||
      (user.pinCodeAttempts || 0) >= MAX_CODE_ATTEMPTS;
    if (expired) {
      return res.status(400).json({
        success: false,
        code: "CODE_EXPIRED",
        message: "This code has expired. Ask for a new one.",
      });
    }

    const codeOk =
      /^\d{6}$/.test(code) && (await bcrypt.compare(code, user.pinCode));
    if (!codeOk) {
      await User.updateOne({ _id: user._id }, { $inc: { pinCodeAttempts: 1 } });
      return res.status(400).json({
        success: false,
        code: "CODE_INCORRECT",
        message: "That code isn't right. Check your email and try again.",
      });
    }

    const isChange = !!user.withdrawalPin;
    await User.updateOne(
      { _id: user._id },
      {
        $set: {
          withdrawalPin: await bcrypt.hash(pin, 10),
          withdrawalPinSet: true,
          // a new PIN lifts any lock from wrong tries
          pinAttempts: 0,
          pinLockedUntil: null,
          // a code works once
          pinCode: null,
          pinCodeExpires: null,
          pinCodeAttempts: 0,
        },
      },
    );

    await Notification.create({
      user: user._id,
      title: isChange ? "Withdrawal PIN changed" : "Withdrawal PIN set",
      message: isChange
        ? "Your withdrawal PIN was changed. If this wasn't you, reset it now and contact support."
        : "Your withdrawal PIN is set. You'll be asked for it on every withdrawal.",
    });

    return res.json({
      success: true,
      message: isChange ? "Your PIN has been changed." : "Your PIN is set.",
    });
  } catch (err) {
    console.error("setWithdrawalPin error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

module.exports = { sendWithdrawalPinCode, setWithdrawalPin };
