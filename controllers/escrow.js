const Escrow = require("../models/escrow");
const User = require("../models/user");
const Notification = require("../models/notification");
const Inspection = require("../models/inspection");
const Purchase = require("../models/purchase");
const Transaction = require("../models/transaction");
const { Dispute } = require("../models/dispute");

// ---------------------------
// Get All Escrows (Admin Only)
// ---------------------------
const getAllEscrows = async (req, res) => {
  try {
    const escrows = await Escrow.find()
      .populate("property", "title location price")
      .populate("buyer", "name email role")
      .populate("seller", "name email role")
      .populate("releasedBy", "name email role")
      .sort({ createdAt: -1 });

    return res.json({
      success: true,
      count: escrows.length,
      escrows,
    });
  } catch (err) {
    console.error("getAllEscrows error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ---------------------------
// Get Single Escrow By ID
// ---------------------------
const getEscrowById = async (req, res) => {
  try {
    const { id } = req.params;

    const escrow = await Escrow.findById(id)
      .populate("property", "title location price")
      .populate("buyer", "name email role")
      .populate("seller", "name email role")
      .populate("purchase")
      .populate("inspection")
      .populate("releasedBy", "name email role");

    if (!escrow) {
      return res
        .status(404)
        .json({ success: false, message: "Escrow record not found" });
    }

    return res.json({
      success: true,
      escrow,
    });
  } catch (err) {
    console.error("getEscrowById error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ---------------------------
// Get Agent Escrows (Agent View)
// ---------------------------
const getAgentEscrows = async (req, res) => {
  try {
    const agentId = req.params.agentId || req.user._id;

    const escrows = await Escrow.find({ seller: agentId })
      .populate("property", "title location price")
      .populate("buyer", "name email role")
      .populate("releasedBy", "name email role")
      .sort({ createdAt: -1 });

    const totalVolume = escrows.reduce((sum, e) => sum + (e.amount || 0), 0);
    const releasedVolume = escrows
      .filter((e) => e.status === "released")
      .reduce((sum, e) => sum + (e.amount || 0), 0);

    return res.json({
      success: true,
      count: escrows.length,
      totalVolume,
      releasedVolume,
      escrows,
    });
  } catch (err) {
    console.error("getAgentEscrows error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ---------------------------
// Change Escrow Status (Admin Only)
// ---------------------------
const changeEscrowStatus = async (req, res) => {
  try {
    if (!req.user || req.user.role !== "admin") {
      return res.status(403).json({
        success: false,
        message: "Access denied. Only administrators can change escrow status.",
      });
    }

    const { escrowId, status, reason, override } = req.body;
    const adminId = req.user._id;

    if (!escrowId || !status) {
      return res
        .status(400)
        .json({ success: false, message: "Escrow ID and status are required" });
    }

    const allowedStatuses = ["on_hold", "released"];
    if (!allowedStatuses.includes(status)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid status value provided" });
    }

    const escrow = await Escrow.findById(escrowId);
    if (!escrow) {
      return res
        .status(404)
        .json({ success: false, message: "Escrow record not found" });
    }

    const previousStatus = escrow.status;

    // Determine exact payout amount: netPayout for purchases, full amount for inspections
    const isPurchase = escrow.type === "purchase" || Boolean(escrow.purchase);
    const payoutAmount = isPurchase
      ? (escrow.netPayout ?? escrow.amount - (escrow.platformFee || 0))
      : escrow.amount;

    if (status === "released" && previousStatus !== "released") {
      let openDispute = null;

      // Fixed Dispute status check to use valid enum values: opened, under_review, escalated
      if (escrow.purchase) {
        openDispute = await Dispute.findOne({
          purchase: escrow.purchase,
          status: { $in: ["opened", "under_review", "escalated"] },
        });
      } else if (escrow.inspection) {
        openDispute = await Dispute.findOne({
          inspection: escrow.inspection,
          status: { $in: ["opened", "under_review", "escalated"] },
        });
      } else {
        openDispute = await Dispute.findOne({
          property: escrow.property,
          buyer: escrow.buyer,
          status: { $in: ["opened", "under_review", "escalated"] },
        });
      }

      if (openDispute && (!override || !reason)) {
        return res.status(400).json({
          success: false,
          message:
            "Cannot release escrow: An open dispute exists for this transaction. An explicit admin override flag and reason are required to proceed.",
          disputeId: openDispute._id,
        });
      }

      const seller = await User.findById(escrow.seller);
      if (!seller) {
        return res
          .status(404)
          .json({ success: false, message: "Seller/Agent not found" });
      }

      seller.balance += payoutAmount;
      await seller.save();

      // 📝 Record the release in transactions with proper `from` and `to`, plus unique reference
      await Transaction.create({
        from: adminId,
        to: seller._id,
        amount: payoutAmount,
        type: "escrow_release",
        status: "completed",
        reference: `${escrow.reference}-rel-${Date.now()}`,
      });

      await Notification.create({
        user: seller._id,
        title: "Escrow Released",
        message: `₦${payoutAmount} from escrow has been released and added to your wallet balance.`,
        meta: { escrowId: escrow._id },
      });

      // 🔌 Send socket notification to that agent only for instant refresh
      if (global.io) {
        global.io.to(seller._id.toString()).emit("notification", {
          type: "escrow_released",
          title: "Escrow Released",
          message: `₦${payoutAmount} has been added to your wallet.`,
          balance: seller.balance,
          escrowId: escrow._id,
        });
      }

      if (escrow.inspection) {
        await Inspection.findByIdAndUpdate(escrow.inspection, {
          feeReleased: true,
        });
      } else if (escrow.purchase) {
        await Purchase.findByIdAndUpdate(escrow.purchase, {
          feeReleased: true,
        });
      } else {
        if (escrow.type === "inspection") {
          await Inspection.findOneAndUpdate(
            { property: escrow.property, user: escrow.buyer },
            { feeReleased: true },
          );
        } else if (escrow.type === "purchase") {
          await Purchase.findOneAndUpdate(
            { property: escrow.property, buyer: escrow.buyer },
            { feeReleased: true },
          );
        }
      }

      escrow.releasedAt = new Date();
      escrow.releasedBy = adminId;
      escrow.reason =
        reason ||
        (override
          ? "Released via admin override despite open dispute"
          : "Funds released by admin");
    }

    if (previousStatus === "released" && status !== "released") {
      const seller = await User.findById(escrow.seller);
      if (seller) {
        seller.balance -= payoutAmount;
        await seller.save();

        // Record reversal transaction with valid `from` and `to`
        await Transaction.create({
          from: adminId,
          to: seller._id,
          amount: payoutAmount,
          type: "escrow_refund",
          status: "completed",
          reference: `${escrow.reference}-rev-${Date.now()}`,
        });

        if (global.io) {
          global.io.to(seller._id.toString()).emit("notification", {
            type: "escrow_reversal",
            title: "Escrow Release Reversed",
            message: `₦${payoutAmount} has been deducted from your wallet due to an escrow status change.`,
            balance: seller.balance,
            escrowId: escrow._id,
          });
        }
      }

      if (escrow.inspection) {
        await Inspection.findByIdAndUpdate(escrow.inspection, {
          feeReleased: false,
        });
      } else if (escrow.purchase) {
        await Purchase.findByIdAndUpdate(escrow.purchase, {
          feeReleased: false,
        });
      } else {
        if (escrow.type === "inspection") {
          await Inspection.findOneAndUpdate(
            { property: escrow.property, user: escrow.buyer },
            { feeReleased: false },
          );
        } else if (escrow.type === "purchase") {
          await Purchase.findOneAndUpdate(
            { property: escrow.property, buyer: escrow.buyer },
            { feeReleased: false },
          );
        }
      }

      escrow.releasedAt = null;
      escrow.releasedBy = null;
      escrow.reason = null;
    }

    escrow.status = status;
    await escrow.save();

    return res.json({
      success: true,
      message: `Escrow status updated to ${status} successfully`,
      escrow,
    });
  } catch (err) {
    console.error("changeEscrowStatus error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ---------------------------
// Admin Refund Escrow
// ---------------------------
const refundEscrow = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    const adminId = req.user._id;

    const escrow = await Escrow.findById(id);
    if (!escrow) {
      return res.status(404).json({
        success: false,
        message: "Escrow record not found.",
      });
    }

    if (escrow.status === "refunded") {
      return res.status(400).json({
        success: false,
        message: "This escrow transaction has already been refunded.",
        escrow,
      });
    }

    const buyer = await User.findByIdAndUpdate(
      escrow.buyer,
      { $inc: { balance: escrow.amount } },
      { new: true },
    );

    if (!buyer) {
      return res.status(404).json({
        success: false,
        message: "Buyer associated with this escrow was not found.",
      });
    }

    escrow.status = "refunded";
    escrow.releasedAt = new Date();
    escrow.releasedBy = adminId;
    escrow.reason = reason || "Refund processed by admin";
    await escrow.save();

    if (escrow.purchase) {
      await Purchase.findByIdAndUpdate(escrow.purchase, {
        status: "purchase_cancelled",
        feeReleased: false,
      });
    } else if (escrow.inspection) {
      await Inspection.findByIdAndUpdate(escrow.inspection, {
        status: "inspection_cancelled",
        feeReleased: false,
      });
    } else if (escrow.property && escrow.buyer) {
      if (escrow.type === "purchase") {
        await Purchase.findOneAndUpdate(
          { property: escrow.property, buyer: escrow.buyer },
          { status: "purchase_cancelled", feeReleased: false },
        );
      } else if (escrow.type === "inspection") {
        await Inspection.findOneAndUpdate(
          { property: escrow.property, user: escrow.buyer },
          { status: "inspection_cancelled", feeReleased: false },
        );
      }
    }

    // Record refund transaction with valid `from` and `to`
    await Transaction.create({
      from: adminId,
      to: escrow.buyer,
      amount: escrow.amount,
      type: "escrow_refund",
      status: "completed",
      reference: `${escrow.reference}-refund-${Date.now()}`,
    });

    if (global.io) {
      global.io.to(escrow.buyer.toString()).emit("notification", {
        type: "escrow_refunded",
        title: "Escrow Refunded",
        message: `An escrow payment of ₦${escrow.amount.toLocaleString()} has been refunded to your wallet.`,
        userId: escrow.buyer,
        escrowId: escrow._id,
      });
    }

    return res.status(200).json({
      success: true,
      message: "Escrow successfully refunded to buyer's wallet.",
      escrow,
    });
  } catch (err) {
    console.error("refundEscrow error:", err);
    return res.status(500).json({
      success: false,
      message: err.message || "An error occurred while refunding the escrow.",
    });
  }
};

module.exports = {
  getAllEscrows,
  getEscrowById,
  getAgentEscrows,
  changeEscrowStatus,
  refundEscrow,
};
