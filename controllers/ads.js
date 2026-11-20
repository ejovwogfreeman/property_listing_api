const Ad = require("../models/ads");
const Property = require("../models/property");
const Purchase = require("../models/purchase");
const {
  DAY_MS,
  TAKEN_STATUSES,
  naira,
  notifyAgent,
  whyNotAdvertisable,
  chargeForAd,
  refundCharge,
  recordAdPayment,
  settleExpiredAds,
  pauseAd,
  resumeAd,
  stopAd,
  stopMessage,
} = require("../middlewares/adBilling");

// A property can have one running or paused ad at a time
const OPEN_STATUSES = ["active", "paused"];

// how many properties the home page features at once
const FEATURED_LIMIT = 8;

// fields a running ad starts with: the whole paid time ahead of it
const launchFields = (duration, charge) => {
  const now = new Date();
  const runMs = duration * DAY_MS;
  return {
    status: "active",
    isPaid: true,
    startDate: now,
    endDate: new Date(now.getTime() + runMs),
    remainingMs: runMs,
    runningSince: now,
    paidFromCredit: charge.fromCredit,
    paidFromWallet: charge.fromWallet,
    spent: 0,
  };
};

const launchedMessage = (title, duration, charge) => {
  const parts = [];
  if (charge.fromCredit > 0)
    parts.push(`${naira(charge.fromCredit)} from ad credit`);
  if (charge.fromWallet > 0)
    parts.push(`${naira(charge.fromWallet)} from your wallet`);
  return `Your ad for "${title}" is live for ${duration} day${duration === 1 ? "" : "s"}. Paid ${parts.join(" and ")}.`;
};

/**
 * @desc Create and launch an ad, paid at once (ad credit first, then wallet)
 * @route POST /api/ads
 */
const createAd = async (req, res) => {
  try {
    if (req.user.role !== "agent") {
      return res.status(403).json({
        success: false,
        message: "Only agents are allowed to create property advertisements",
      });
    }

    const { property, objective } = req.body;
    const dailyBudget = Math.round(Number(req.body.dailyBudget));
    const duration = Math.round(Number(req.body.duration));

    if (!property || !objective) {
      return res.status(400).json({
        success: false,
        message: "Property and objective are required.",
      });
    }
    if (!(dailyBudget > 0) || !(duration >= 1)) {
      return res.status(400).json({
        success: false,
        message: "Daily budget and duration must be positive numbers.",
      });
    }

    const prop = await Property.findById(property);
    if (!prop) {
      return res
        .status(404)
        .json({ success: false, message: "Property not found" });
    }
    if (prop.owner._id.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: "Not authorized to advertise a property you do not own",
      });
    }

    const reason = await whyNotAdvertisable(prop._id);
    if (reason) {
      return res.status(400).json({ success: false, message: reason });
    }

    await settleExpiredAds();
    const existing = await Ad.exists({
      property: prop._id,
      status: { $in: OPEN_STATUSES },
    });
    if (existing) {
      return res.status(400).json({
        success: false,
        message:
          "This property already has a running or paused ad. Resume that one, or wait for it to finish.",
      });
    }

    const adBudget = dailyBudget * duration;
    const charge = await chargeForAd(req.user._id, adBudget);
    if (!charge.ok) {
      return res.status(400).json({
        success: false,
        message: charge.message,
        shortBy: charge.shortBy,
      });
    }

    let ad;
    try {
      ad = await Ad.create({
        user: req.user._id,
        property: prop._id,
        objective,
        dailyBudget,
        duration,
        adBudget,
        ...launchFields(duration, charge),
      });
    } catch (createErr) {
      // give the money back if the ad couldn't be saved
      await refundCharge(req.user._id, charge);
      throw createErr;
    }

    await recordAdPayment(req.user._id, charge.fromWallet, ad);
    await ad.populate("property");
    await notifyAgent(
      req.user._id,
      "Ad Launched",
      launchedMessage(prop.title, duration, charge),
      ad._id,
    );

    res.status(201).json({
      success: true,
      message: "Ad launched.",
      data: ad,
      balance: charge.balance,
      adCredit: charge.adCredit,
    });
  } catch (err) {
    console.error("createAd error:", err);
    res
      .status(500)
      .json({ success: false, message: "Server error", error: err.message });
  }
};

/**
 * @desc Get all ads (Admins see all, agents see their own)
 * @route GET /api/ads
 */
const getAds = async (req, res) => {
  try {
    await settleExpiredAds();

    const query = {};
    if (req.user.role !== "admin") {
      query.user = req.user._id;
    }

    const ads = await Ad.find(query)
      .sort({ createdAt: -1 })
      .populate("property")
      .populate("user", "name email phoneNumber profilePicture adCredit");

    res.status(200).json({
      success: true,
      total: ads.length,
      data: ads,
    });
  } catch (err) {
    console.error("getAds error:", err);
    res
      .status(500)
      .json({ success: false, message: "Server error", error: err.message });
  }
};

/**
 * @desc Get a single ad by ID
 * @route GET /api/ads/:id
 */
const getAd = async (req, res) => {
  try {
    await settleExpiredAds();

    const ad = await Ad.findById(req.params.id)
      .populate("property")
      .populate("user", "name email phoneNumber profilePicture adCredit");

    if (!ad) {
      return res.status(404).json({ success: false, message: "Ad not found" });
    }

    if (
      ad.user._id.toString() !== req.user._id.toString() &&
      req.user.role !== "admin"
    ) {
      return res
        .status(403)
        .json({ success: false, message: "Not authorized" });
    }

    res.status(200).json({
      success: true,
      data: ad,
    });
  } catch (err) {
    console.error("getAd error:", err);
    res
      .status(500)
      .json({ success: false, message: "Server error", error: err.message });
  }
};

/**
 * @desc Change a launched ad's state. Agents: { status: "paused" } or
 *       { status: "active" } (resume). Admins: { status: "stopped" }.
 *       A launched ad's details can't be edited.
 * @route PATCH /api/ads/:id
 */
const updateAd = async (req, res) => {
  try {
    const { status } = req.body;

    await settleExpiredAds();
    const ad = await Ad.findById(req.params.id).populate("property", "title");
    if (!ad) {
      return res.status(404).json({ success: false, message: "Ad not found" });
    }

    const isAdmin = req.user.role === "admin";
    const isOwner = ad.user.toString() === req.user._id.toString();
    if (!isAdmin && !isOwner) {
      return res
        .status(403)
        .json({ success: false, message: "Not authorized" });
    }

    const title = ad.property?.title || "your property";

    // an admin can only stop an ad; its unused time goes to the agent's ad credit
    if (isAdmin) {
      if (status !== "stopped") {
        return res.status(400).json({
          success: false,
          message: 'Admins can only stop an ad ({ status: "stopped" }).',
        });
      }
      const result = await stopAd(ad, "admin");
      if (!result) {
        return res.status(400).json({
          success: false,
          message: "Only a running or paused ad can be stopped.",
        });
      }
      await notifyAgent(
        ad.user,
        "Ad Stopped",
        stopMessage(title, "admin", result),
        ad._id,
      );
      return res.status(200).json({
        success: true,
        message: "Ad stopped.",
        data: result.ad,
      });
    }

    // the agent can only pause and resume
    if (status === "paused") {
      if (ad.status !== "active") {
        return res.status(400).json({
          success: false,
          message: "Only a running ad can be paused.",
        });
      }
      const result = await pauseAd(ad);
      if (!result) {
        return res.status(400).json({
          success: false,
          message: "This ad was just changed. Refresh and try again.",
        });
      }
      await notifyAgent(
        ad.user,
        "Ad Paused",
        `Your ad for "${title}" is paused. The unused ${naira(result.credited)} is in your ad credit until you resume it or use it on another ad.`,
        ad._id,
      );
      return res.status(200).json({
        success: true,
        message: "Ad paused.",
        data: result.ad,
      });
    }

    if (status === "active") {
      if (ad.status !== "paused") {
        return res.status(400).json({
          success: false,
          message: "Only a paused ad can be resumed.",
        });
      }
      const result = await resumeAd(ad);
      if (!result.ok) {
        return res.status(400).json({
          success: false,
          message: result.message,
          shortBy: result.shortBy,
        });
      }
      await notifyAgent(
        ad.user,
        "Ad Resumed",
        `Your ad for "${title}" is running again.`,
        ad._id,
      );
      return res.status(200).json({
        success: true,
        message: "Ad resumed.",
        data: result.ad,
        balance: result.charge.balance,
        adCredit: result.charge.adCredit,
      });
    }

    return res.status(400).json({
      success: false,
      message:
        "A launched ad can't be edited or stopped. You can only pause or resume it.",
    });
  } catch (err) {
    console.error("updateAd error:", err);
    res
      .status(500)
      .json({ success: false, message: "Server error", error: err.message });
  }
};

/**
 * @desc Delete an ad. An agent can only delete an unpaid ad; a paid one is
 *       kept as the record of what was paid. An admin can delete any ad that
 *       isn't running or paused (stop it first, so its unused days reach the
 *       agent's ad credit).
 * @route DELETE /api/ads/:id
 */
const deleteAd = async (req, res) => {
  try {
    const ad = await Ad.findById(req.params.id);
    if (!ad) {
      return res.status(404).json({ success: false, message: "Ad not found" });
    }

    const isAdmin = req.user.role === "admin";
    if (ad.user.toString() !== req.user._id.toString() && !isAdmin) {
      return res
        .status(403)
        .json({ success: false, message: "Not authorized" });
    }

    const isLive =
      (ad.status === "active" && ad.runningSince) || ad.status === "paused";
    if (isAdmin && isLive) {
      return res.status(400).json({
        success: false,
        message:
          "Stop this ad first, so its unused days go to the agent's ad credit.",
      });
    }
    if (!isAdmin && ad.isPaid) {
      return res.status(400).json({
        success: false,
        message:
          "A launched ad can't be deleted. It's kept as the record of what was paid.",
      });
    }

    await ad.deleteOne();

    res.status(200).json({
      success: true,
      message: "Ad deleted successfully",
    });
  } catch (err) {
    console.error("deleteAd error:", err);
    res
      .status(500)
      .json({ success: false, message: "Server error", error: err.message });
  }
};

/**
 * @desc Featured properties for the home page: up to 8 running ads on
 *       properties still on the market, in a random order. Each one shown
 *       counts as a view. Public.
 * @route GET /api/ads/featured
 */
const getFeaturedAds = async (req, res) => {
  try {
    await settleExpiredAds();

    const running = await Ad.find({
      status: "active",
      runningSince: { $ne: null },
    })
      .select("property")
      .populate(
        "property",
        "-adminNotes -flagReason -statusHistory -rejectionReason -legalDocuments",
      )
      .lean();

    const takenIds = await Purchase.distinct("property", {
      property: { $in: running.map((a) => a.property?._id).filter(Boolean) },
      $or: [{ holdsProperty: true }, { status: { $in: TAKEN_STATUSES } }],
    });
    const taken = new Set(takenIds.map((id) => id.toString()));

    const eligible = running.filter(
      (a) =>
        a.property &&
        a.property.status === "approved" &&
        !a.property.isFlagged &&
        !taken.has(a.property._id.toString()),
    );

    // shuffle, so every running ad gets its turn on the page
    for (let i = eligible.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [eligible[i], eligible[j]] = [eligible[j], eligible[i]];
    }
    const picked = eligible.slice(0, FEATURED_LIMIT);

    if (picked.length > 0) {
      await Ad.updateMany({ _id: { $in: picked.map((a) => a._id) } }, [
        { $set: { views: { $add: [{ $ifNull: ["$views", 0] }, 1] } } },
        {
          $set: {
            ctr: {
              $round: [
                {
                  $multiply: [
                    { $divide: [{ $ifNull: ["$clicks", 0] }, "$views"] },
                    100,
                  ],
                },
                2,
              ],
            },
          },
        },
      ]);
    }

    res.status(200).json({
      success: true,
      data: picked.map((a) => ({
        adId: a._id,
        property: { ...a.property, isTaken: false },
      })),
    });
  } catch (err) {
    console.error("getFeaturedAds error:", err);
    res
      .status(500)
      .json({ success: false, message: "Server error", error: err.message });
  }
};

/**
 * @desc Count a click on a featured property. Public.
 * @route POST /api/ads/:id/click
 */
const recordAdClick = async (req, res) => {
  try {
    await Ad.updateOne({ _id: req.params.id, status: "active" }, [
      { $set: { clicks: { $add: [{ $ifNull: ["$clicks", 0] }, 1] } } },
      {
        $set: {
          ctr: {
            $cond: [
              { $gt: [{ $ifNull: ["$views", 0] }, 0] },
              {
                $round: [
                  { $multiply: [{ $divide: ["$clicks", "$views"] }, 100] },
                  2,
                ],
              },
              0,
            ],
          },
        },
      },
    ]);
    res.status(200).json({ success: true });
  } catch (err) {
    console.error("recordAdClick error:", err);
    res.status(200).json({ success: false });
  }
};

module.exports = {
  createAd,
  getAds,
  getAd,
  updateAd,
  deleteAd,
  getFeaturedAds,
  recordAdClick,
};
