const Escrow = require("../models/escrow");
const User = require("../models/user");
const Notification = require("../models/notification");
const Inspection = require("../models/inspection");
const Purchase = require("../models/purchase");
const Transaction = require("../models/transaction");
const { Dispute } = require("../models/dispute");
const { calculateRefundFee } = require("../middlewares/platformFee");
const { syncPropertySold } = require("../middlewares/propertyTaken");

// Helper for targeted socket notifications with error isolation
const notifyUser = (userId, event, data) => {
  try {
    if (global.io && userId) {
      global.io.to(userId.toString()).emit(event, data);
    }
  } catch (err) {
    console.error("Socket notification error:", err);
  }
};

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

    // Block modifying escrows that are in refund review or already refunded
    if (["refund_pending", "refunded"].includes(escrow.status)) {
      return res.status(400).json({
        success: false,
        message: `Cannot change status: Escrow is currently in ${escrow.status} state.`,
      });
    }

    const previousStatus = escrow.status;

    // Determine exact payout amount: netPayout for purchases, full amount for inspections
    const isPurchase = escrow.type === "purchase" || Boolean(escrow.purchase);
    const payoutAmount = isPurchase
      ? (escrow.netPayout ?? escrow.amount - (escrow.platformFee || 0))
      : escrow.amount;

    if (status === "released" && previousStatus !== "released") {
      let openDispute = null;

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

      // seller.balance += payoutAmount;
      // await seller.save();

      const claimed = await Escrow.findOneAndUpdate(
        { _id: escrow._id, status: "on_hold" },
        { $set: { status: "released" } },
      );
      if (!claimed) {
        return res
          .status(400)
          .json({ success: false, message: "Escrow was already released." });
      }
      const credited = await User.findByIdAndUpdate(
        seller._id,
        { $inc: { balance: payoutAmount } },
        { new: true },
      );
      seller.balance = credited.balance;

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
        message: `Funds from escrow have been released and added to your wallet balance.`,
        meta: { escrowId: escrow._id },
      });

      notifyUser(seller._id, "notification", {
        type: "escrow_released",
        title: "Escrow Released",
        message: `Escrow funds have been added to your wallet.`,
        balance: seller.balance,
        escrowId: escrow._id,
      });

      // the buyer's timeline shows "funds released to agent", so tell them too
      // (no balance here: the money is the agent's)
      if (escrow.buyer) {
        const buyerMessage = isPurchase
          ? "Your purchase is complete. The payment held in escrow has been released to the agent."
          : "Your inspection is complete. The inspection fee held in escrow has been released to the agent.";
        await Notification.create({
          user: escrow.buyer,
          title: "Funds Released to Agent",
          message: buyerMessage,
          meta: { escrowId: escrow._id },
        });
        notifyUser(escrow.buyer, "notification", {
          type: "escrow_released",
          title: "Funds Released to Agent",
          message: buyerMessage,
          escrowId: escrow._id,
        });
      }

      if (escrow.inspection) {
        await Inspection.findByIdAndUpdate(escrow.inspection, {
          feeReleased: true,
          feeReleasedAt: new Date(),
        });
      } else if (escrow.purchase) {
        await Purchase.findByIdAndUpdate(escrow.purchase, {
          feeReleased: true,
          feeReleasedAt: new Date(),
        });
      }

      escrow.releasedAt = new Date();
      escrow.releasedBy = adminId;
      escrow.reason =
        reason ||
        (override
          ? "Released via admin override despite open dispute"
          : "Funds released by admin");
    }

    // if (previousStatus === "released" && status !== "released") {
    //   const seller = await User.findById(escrow.seller);
    //   if (seller) {
    //     seller.balance -= payoutAmount;
    //     await seller.save();

    if (previousStatus === "released" && status !== "released") {
      // Claim it first so two clicks can't both take the money back
      const reclaimed = await Escrow.findOneAndUpdate(
        { _id: escrow._id, status: "released" },
        { $set: { status } },
      );
      if (!reclaimed) {
        return res
          .status(400)
          .json({ success: false, message: "Escrow is no longer released." });
      }
      const seller = await User.findById(escrow.seller);
      if (seller) {
        const debited = await User.findByIdAndUpdate(
          seller._id,
          { $inc: { balance: -payoutAmount } },
          { new: true },
        );
        seller.balance = debited.balance;

        await Transaction.create({
          from: adminId,
          to: seller._id,
          amount: payoutAmount,
          type: "escrow_refund",
          status: "completed",
          reference: `${escrow.reference}-rev-${Date.now()}`,
        });

        notifyUser(seller._id, "notification", {
          type: "escrow_reversal",
          title: "Escrow Release Reversed",
          message: `Funds have been deducted from your wallet due to an escrow status change.`,
          balance: seller.balance,
          escrowId: escrow._id,
        });
      }

      // the buyer's timeline goes back to "pending" too
      notifyUser(escrow.buyer, "notification", {
        type: "escrow_reversal",
        title: "Escrow Back On Hold",
        message: "The escrow for this transaction is back on hold.",
        escrowId: escrow._id,
      });

      if (escrow.inspection) {
        await Inspection.findByIdAndUpdate(escrow.inspection, {
          feeReleased: false,
          feeReleasedAt: null,
        });
      } else if (escrow.purchase) {
        await Purchase.findByIdAndUpdate(escrow.purchase, {
          feeReleased: false,
          feeReleasedAt: null,
        });
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
// Step 1: Approve Escrow Refund (Admin Only - Two-Step Flow)
// ---------------------------
const approveEscrowRefund = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    const adminId = req.user._id;

    if (!req.user || req.user.role !== "admin") {
      return res
        .status(403)
        .json({ success: false, message: "Admin access required." });
    }

    // Atomically claim escrow from on_hold status to refund_pending
    const escrow = await Escrow.findOneAndUpdate(
      { _id: id, status: "on_hold" },
      {
        $set: {
          status: "refund_pending",
          reason: reason || "Refund approved by admin",
          refundApprovedAt: new Date(),
          refundApprovedBy: adminId,
        },
      },
      { new: true },
    );

    if (!escrow) {
      return res.status(400).json({
        success: false,
        message:
          "Escrow not found or cannot be refunded because it is not in 'on_hold' status (may already be released, refunded, or pending).",
      });
    }

    // Cancel related inspection or purchase and release property locks
    if (escrow.purchase) {
      await Purchase.findByIdAndUpdate(escrow.purchase, {
        status: "purchase_cancelled",
        holdsProperty: false,
        refundDue: true,
        refundAmount: escrow.amount,
        cancelledAt: new Date(),
        feeReleased: false,
      });
    } else if (escrow.inspection) {
      await Inspection.findByIdAndUpdate(escrow.inspection, {
        status: "inspection_cancelled",
        refundDue: true,
        refundAmount: escrow.amount,
        cancelledAt: new Date(),
        feeReleased: false,
      });
    } else if (escrow.property && escrow.buyer) {
      if (escrow.type === "purchase") {
        await Purchase.findOneAndUpdate(
          { property: escrow.property, buyer: escrow.buyer },
          {
            status: "purchase_cancelled",
            holdsProperty: false,
            refundDue: true,
            refundAmount: escrow.amount,
            cancelledAt: new Date(),
            feeReleased: false,
          },
        );
      } else if (escrow.type === "inspection") {
        await Inspection.findOneAndUpdate(
          { property: escrow.property, user: escrow.buyer },
          {
            status: "inspection_cancelled",
            refundDue: true,
            refundAmount: escrow.amount,
            cancelledAt: new Date(),
            feeReleased: false,
          },
        );
      }
    }

    // a refunded purchase is no longer a sale: the property goes back on the market
    if (escrow.purchase || escrow.type === "purchase") {
      await syncPropertySold(escrow.property);
    }

    // Notify buyer (offline payment method note) and seller
    await Notification.create({
      user: escrow.buyer,
      title: "Refund Approved",
      message: `Your escrow refund of ${escrow.amount.toLocaleString()} has been approved and will be sent to your original payment method.`,
      meta: { escrowId: escrow._id },
    });

    notifyUser(escrow.buyer, "notification", {
      type: "escrow_refund_approved",
      title: "Refund Approved",
      message: `Your refund has been approved and is being processed offline.`,
      escrowId: escrow._id,
    });

    if (escrow.seller) {
      await Notification.create({
        user: escrow.seller,
        title: "Escrow Refunded / Deal Cancelled",
        message: `An escrow transaction was cancelled and approved for refund.`,
        meta: { escrowId: escrow._id },
      });
      notifyUser(escrow.seller, "notification", {
        type: "escrow_refund_approved",
        title: "Escrow Cancelled",
        message: `Transaction escrow has been approved for refund.`,
        escrowId: escrow._id,
      });
    }

    return res.status(200).json({
      success: true,
      message:
        "Escrow refund approved successfully. Deal cancelled and set to refund pending.",
      escrow,
    });
  } catch (err) {
    console.error("approveEscrowRefund error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ---------------------------
// Step 2: Mark Escrow Refund Sent (Admin Only - Two-Step Flow)
// ---------------------------
const completeEscrowRefund = async (req, res) => {
  try {
    const { id } = req.params;
    // const { amountSent, transferReference, note } = req.body;
    const { amountSent, transferReference, note, waiveProcessingFee } =
      req.body;

    const adminId = req.user._id;

    if (!req.user || req.user.role !== "admin") {
      return res
        .status(403)
        .json({ success: false, message: "Admin access required." });
    }

    // Atomically claim from refund_pending to refunded

    // the buyer's refund processing fee, unless the admin waived it
    const pending = await Escrow.findById(id);
    // const fee =
    //   waiveProcessingFee === true || waiveProcessingFee === "true"
    //     ? 0
    //     : calculateRefundFee(pending?.amount || 0);

    const fee =
      waiveProcessingFee === true ||
      waiveProcessingFee === "true" ||
      pending?.refundFeeWaived
        ? 0
        : calculateRefundFee(pending?.amount || 0);

    const escrow = await Escrow.findOneAndUpdate(
      { _id: id, status: "refund_pending" },
      {
        $set: {
          status: "refunded",
          refundedAt: new Date(),
          // refundedAmount: amountSent || null,
          refundedAmount: Number(amountSent) || null,
          refundProcessingFee: fee,
          transferReference,
          refundNote: note,
          releasedAt: new Date(),
          releasedBy: adminId,
        },
      },
      { new: true },
    );

    if (!escrow) {
      return res.status(400).json({
        success: false,
        message:
          "Escrow not found or is not currently in 'refund_pending' status.",
      });
    }

    if (!escrow.refundedAmount) {
      // escrow.refundedAmount = escrow.amount;
      escrow.refundedAmount = escrow.amount - fee;
      await escrow.save();
    }

    // Record ledger Transaction ONLY (Zero buyer wallet crediting)
    await Transaction.create({
      from: adminId,
      to: escrow.buyer,
      amount: escrow.refundedAmount || escrow.amount,
      type: "escrow_refund",
      status: "completed",
      reference:
        transferReference || `${escrow.reference}-refund-${Date.now()}`,
    });

    const refundRecord = {
      refundDue: false,
      refundSentAt: new Date(),
      // refundSentAmount: escrow.refundedAmount,
      // refundReference: transferReference,
      refundSentAmount: escrow.refundedAmount,
      refundProcessingFee: fee,
      refundReference: transferReference,
      refundNote: note,
    };
    if (escrow.purchase) {
      await Purchase.findByIdAndUpdate(escrow.purchase, refundRecord);
    } else if (escrow.inspection) {
      await Inspection.findByIdAndUpdate(escrow.inspection, refundRecord);
    }

    await Notification.create({
      user: escrow.buyer,
      title: "Refund Sent",
      // message: `Your offline refund of ${(escrow.refundedAmount || escrow.amount).toLocaleString()} has been sent. Reference: ${transferReference || "N/A"}`,
      message: `Your refund of ₦${(escrow.refundedAmount || escrow.amount).toLocaleString()} has been sent${fee ? ` (a ₦${fee.toLocaleString()} processing fee was deducted)` : ""}. Reference: ${transferReference || "N/A"}`,
      meta: { escrowId: escrow._id },
    });

    notifyUser(escrow.buyer, "notification", {
      type: "escrow_refund_sent",
      title: "Refund Sent",
      message: `Your refund has been marked as sent by admin.`,
      escrowId: escrow._id,
    });

    return res.status(200).json({
      success: true,
      message:
        "Escrow refund marked as sent and recorded on ledger successfully.",
      escrow,
    });
  } catch (err) {
    console.error("completeEscrowRefund error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = {
  getAllEscrows,
  getEscrowById,
  getAgentEscrows,
  changeEscrowStatus,
  approveEscrowRefund,
  completeEscrowRefund,
};
