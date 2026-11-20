const Ad = require("../models/ads");
const User = require("../models/user");
const Property = require("../models/property");
const Purchase = require("../models/purchase");
const Transaction = require("../models/transaction");
const Notification = require("../models/notification");

// How ads are paid for
// - An ad costs dailyBudget x duration, paid when it's launched: ad credit
//   first, then the wallet.
// - A running ad uses up its paid time day by day (remainingMs counts down
//   from runningSince).
// - Pausing stops the clock and puts the value of the unused time into the
//   agent's ad credit. Resuming takes it again (credit first, then wallet).
// - When the paid time runs out the ad is "completed". When its property is
//   secured by a buyer, rejected, flagged or deleted, or an admin stops it,
//   it's "stopped" and the unused time goes to ad credit.
// - Ad credit can only be spent on ads. It's never withdrawn.
// There's no scheduler: settleExpiredAds() ends finished ads whenever ads
// are read, so every list is current.

const DAY_MS = 24 * 60 * 60 * 1000;

// A buyer has paid for the property, or their payment is under review
// (same list as controllers/property.js)
const TAKEN_STATUSES = [
  "property_payment_made",
  "handover_requested",
  "handover_scheduled",
  "handover_rescheduled",
  "handover_confirmed",
  "handover_completed",
  "funds_released",
];

const notifyUser = (userId, data) => {
  try {
    if (global.io && userId) {
      global.io.to(userId.toString()).emit("notification", data);
    }
  } catch (err) {
    console.error("Socket notification error:", err);
  }
};

// a saved notification plus a live event, so My Ads and the ad credit refresh
const notifyAgent = async (userId, title, message, adId) => {
  await Notification.create({ user: userId, title, message, meta: { adId } });
  notifyUser(userId, { type: "ad_updated", title, message, adId });
};

const naira = (n) => `₦${Math.round(n).toLocaleString()}`;

// What `ms` of an ad's run time is worth
const valueOf = (ad, ms) =>
  Math.round(((ad.dailyBudget || 0) * Math.max(0, ms)) / DAY_MS);

// Why a property can't carry an ad right now, or null when it can
const whyNotAdvertisable = async (propertyRef) => {
  const propertyId = propertyRef?._id || propertyRef;
  const property =
    await Property.findById(propertyId).select("status isFlagged");
  if (!property) return "Property not found.";
  if (property.status === "sold") {
    return "This property has been sold or rented, so it can't be advertised.";
  }
  if (property.status !== "approved") {
    return "Only approved, active properties can be advertised.";
  }
  if (property.isFlagged) {
    return "This property has been flagged by an admin, so it can't be advertised.";
  }
  const taken = await Purchase.exists({
    property: propertyId,
    $or: [{ holdsProperty: true }, { status: { $in: TAKEN_STATUSES } }],
  });
  if (taken) {
    return "A buyer has paid for this property, so it can't be advertised.";
  }
  return null;
};

// Takes `amount` for an ad: ad credit first, then the wallet. Each attempt is
// one conditional update, so a double tap or a balance change at the same
// moment can't overdraw either balance.
const chargeForAd = async (userId, amount) => {
  for (let attempt = 0; attempt < 3; attempt++) {
    const user = await User.findById(userId).select("adCredit balance");
    if (!user) return { ok: false, message: "User not found." };

    const credit = user.adCredit || 0;
    const balance = user.balance || 0;
    const fromCredit = Math.min(credit, amount);
    const fromWallet = amount - fromCredit;

    if (fromWallet > balance) {
      const shortBy = fromWallet - balance;
      return {
        ok: false,
        shortBy,
        message: `Not enough funds. This ad costs ${naira(amount)}. You have ${naira(credit)} ad credit and ${naira(balance)} in your wallet, so fund your wallet with at least ${naira(shortBy)}.`,
      };
    }

    const filter = { _id: userId };
    if (fromCredit > 0) filter.adCredit = { $gte: fromCredit };
    if (fromWallet > 0) filter.balance = { $gte: fromWallet };

    const updated = await User.findOneAndUpdate(
      filter,
      { $inc: { adCredit: -fromCredit, balance: -fromWallet } },
      { new: true },
    );
    if (updated) {
      return {
        ok: true,
        fromCredit,
        fromWallet,
        adCredit: updated.adCredit || 0,
        balance: updated.balance || 0,
      };
    }
    // a balance changed between the read and the update: read again
  }
  return { ok: false, message: "Your balance just changed. Please try again." };
};

// puts a charge back, when the ad it paid for couldn't be saved
const refundCharge = async (userId, charge) => {
  await User.findByIdAndUpdate(userId, {
    $inc: { adCredit: charge.fromCredit, balance: charge.fromWallet },
  });
};

const creditAd = async (userId, amount) => {
  if (!amount || amount <= 0) return;
  await User.findByIdAndUpdate(userId, { $inc: { adCredit: amount } });
};

// The wallet part of an ad payment, so it shows in the agent's wallet
// activity and in the admin's reports. Ad credit is already the platform's,
// so the credit part isn't a new payment.
const recordAdPayment = async (userId, amount, ad) => {
  if (!amount || amount <= 0) return;
  await Transaction.create({
    from: userId,
    amount,
    type: "ad_payment",
    status: "completed",
    reference: `ad-${ad._id}-${Date.now()}`,
  });
};

// Ends every running ad whose paid time has run out. One update, run before
// ads are read, instead of a scheduler.
const settleExpiredAds = async () => {
  const now = new Date();
  await Ad.updateMany(
    {
      status: "active",
      runningSince: { $ne: null },
      $expr: {
        $gte: [{ $subtract: [now, "$runningSince"] }, "$remainingMs"],
      },
    },
    [
      {
        $set: {
          status: "completed",
          endedAt: { $add: ["$runningSince", "$remainingMs"] },
          spent: {
            $add: [
              { $ifNull: ["$spent", 0] },
              {
                $round: [
                  {
                    $divide: [
                      { $multiply: ["$dailyBudget", "$remainingMs"] },
                      DAY_MS,
                    ],
                  },
                  0,
                ],
              },
            ],
          },
          remainingMs: 0,
          runningSince: null,
        },
      },
    ],
  );
};

// The run time an active ad has used since it last started, capped at what it has
const elapsedOf = (ad) =>
  Math.min(
    Math.max(0, Date.now() - new Date(ad.runningSince).getTime()),
    ad.remainingMs,
  );

// Stops the clock and moves the unused time's value into ad credit
const pauseAd = async (ad) => {
  const elapsed = elapsedOf(ad);
  const remaining = ad.remainingMs - elapsed;
  const paused = await Ad.findOneAndUpdate(
    { _id: ad._id, status: "active", runningSince: ad.runningSince },
    {
      $set: { status: "paused", remainingMs: remaining, runningSince: null },
      $inc: { spent: valueOf(ad, elapsed) },
    },
    { new: true },
  );
  if (!paused) return null;
  const credited = valueOf(ad, remaining);
  await creditAd(ad.user, credited);
  return { ad: paused, credited };
};

// Starts the clock again, paying for the remaining time (credit first)
const resumeAd = async (ad) => {
  const reason = await whyNotAdvertisable(ad.property);
  if (reason) return { ok: false, message: reason };

  const amount = valueOf(ad, ad.remainingMs);
  const charge = await chargeForAd(ad.user, amount);
  if (!charge.ok) return charge;

  const now = new Date();
  const resumed = await Ad.findOneAndUpdate(
    { _id: ad._id, status: "paused" },
    {
      $set: {
        status: "active",
        runningSince: now,
        endDate: new Date(now.getTime() + ad.remainingMs),
      },
      $inc: {
        paidFromCredit: charge.fromCredit,
        paidFromWallet: charge.fromWallet,
      },
    },
    { new: true },
  );
  if (!resumed) {
    await refundCharge(ad.user, charge);
    return {
      ok: false,
      message: "This ad was just changed. Refresh and try again.",
    };
  }
  await recordAdPayment(ad.user, charge.fromWallet, ad);
  return { ok: true, ad: resumed, charge };
};

// Ends an ad early. A running ad's unused time goes to ad credit; a paused
// ad's already went there when it was paused.
const stopAd = async (ad, reason) => {
  if (ad.status === "active" && ad.runningSince) {
    const elapsed = elapsedOf(ad);
    const remaining = ad.remainingMs - elapsed;
    const stopped = await Ad.findOneAndUpdate(
      { _id: ad._id, status: "active", runningSince: ad.runningSince },
      {
        $set: {
          status: "stopped",
          stopReason: reason,
          remainingMs: 0,
          runningSince: null,
          endedAt: new Date(),
        },
        $inc: { spent: valueOf(ad, elapsed) },
      },
      { new: true },
    );
    if (!stopped) return null;
    const credited = valueOf(ad, remaining);
    await creditAd(ad.user, credited);
    return { ad: stopped, credited, wasPaused: false };
  }

  if (ad.status === "paused") {
    const stopped = await Ad.findOneAndUpdate(
      { _id: ad._id, status: "paused" },
      {
        $set: {
          status: "stopped",
          stopReason: reason,
          remainingMs: 0,
          endedAt: new Date(),
        },
      },
      { new: true },
    );
    return stopped ? { ad: stopped, credited: 0, wasPaused: true } : null;
  }

  return null;
};

const STOP_REASONS = {
  property_secured: "a buyer has secured the property",
  property_rejected: "the listing was rejected",
  property_flagged: "the listing was flagged by an admin",
  property_deleted: "the listing was deleted",
  admin: "an admin stopped it",
};

const stopMessage = (title, reason, result) => {
  const why = STOP_REASONS[reason] || "it can no longer run";
  const money =
    result.credited > 0
      ? ` The unused ${naira(result.credited)} has been added to your ad credit for your next ad.`
      : result.wasPaused
        ? " Its unused days are already in your ad credit."
        : "";
  return `Your ad for "${title}" has stopped because ${why}.${money}`;
};

// Stops every running or paused ad on a property (secured, rejected,
// flagged or deleted). Never throws: the caller's own action must go ahead.
const stopAdsForProperty = async (propertyRef, reason) => {
  try {
    const propertyId = propertyRef?._id || propertyRef;
    if (!propertyId) return;
    await settleExpiredAds();
    const ads = await Ad.find({
      property: propertyId,
      status: { $in: ["active", "paused"] },
    }).populate("property", "title");

    for (const ad of ads) {
      const result = await stopAd(ad, reason);
      if (!result) continue;
      await notifyAgent(
        ad.user,
        "Ad Stopped",
        stopMessage(ad.property?.title || "your property", reason, result),
        ad._id,
      );
    }
  } catch (err) {
    console.error("stopAdsForProperty error:", err);
  }
};

// Pauses every running ad on a property that went back to review. The agent
// can resume once it's approved again. Never throws.
const pauseAdsForProperty = async (propertyRef) => {
  try {
    const propertyId = propertyRef?._id || propertyRef;
    if (!propertyId) return;
    await settleExpiredAds();
    const ads = await Ad.find({
      property: propertyId,
      status: "active",
      runningSince: { $ne: null },
    }).populate("property", "title");

    for (const ad of ads) {
      const result = await pauseAd(ad);
      if (!result) continue;
      await notifyAgent(
        ad.user,
        "Ad Paused",
        `Your ad for "${ad.property?.title || "your property"}" was paused because the listing is back under review. The unused ${naira(result.credited)} is in your ad credit; resume the ad once the listing is approved.`,
        ad._id,
      );
    }
  } catch (err) {
    console.error("pauseAdsForProperty error:", err);
  }
};

module.exports = {
  DAY_MS,
  TAKEN_STATUSES,
  naira,
  notifyAgent,
  valueOf,
  whyNotAdvertisable,
  chargeForAd,
  refundCharge,
  recordAdPayment,
  settleExpiredAds,
  pauseAd,
  resumeAd,
  stopAd,
  stopMessage,
  stopAdsForProperty,
  pauseAdsForProperty,
};
