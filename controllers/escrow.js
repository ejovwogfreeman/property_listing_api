// const Escrow = require("../models/escrow");
// const User = require("../models/user");
// const Notification = require("../models/notification");
// const Inspection = require("../models/inspection");
// const Purchase = require("../models/purchase");
// const Transaction = require("../models/transaction");

// // ---------------------------
// // Get All Escrows (Admin Only)
// // ---------------------------

// const getAllEscrows = async (req, res) => {
//   try {
//     const escrows = await Escrow.find()
//       .populate("property", "title location price")
//       .populate("buyer", "name email role")
//       .populate("seller", "name email role")
//       .populate("releasedBy", "name email role")
//       .sort({ createdAt: -1 });

//     return res.json({
//       success: true,
//       count: escrows.length,
//       escrows,
//     });
//   } catch (err) {
//     console.error("getAllEscrows error:", err);
//     return res.status(500).json({ success: false, message: err.message });
//   }
// };

// // ---------------------------
// // Get Single Escrow By ID
// // ---------------------------
// const getEscrowById = async (req, res) => {
//   try {
//     const { id } = req.params;

//     const escrow = await Escrow.findById(id)
//       .populate("property", "title location price")
//       .populate("buyer", "name email role")
//       .populate("seller", "name email role")
//       .populate("purchase")
//       .populate("inspection")
//       .populate("releasedBy", "name email role");

//     if (!escrow) {
//       return res
//         .status(404)
//         .json({ success: false, message: "Escrow record not found" });
//     }

//     return res.json({
//       success: true,
//       escrow,
//     });
//   } catch (err) {
//     console.error("getEscrowById error:", err);
//     return res.status(500).json({ success: false, message: err.message });
//   }
// };

// // ---------------------------
// // Get Agent Escrows (Agent View)
// // ---------------------------
// const getAgentEscrows = async (req, res) => {
//   try {
//     // Allows looking up by param if admin, or defaulting to logged-in agent
//     const agentId = req.params.agentId || req.user._id;

//     const escrows = await Escrow.find({ seller: agentId })
//       .populate("property", "title location price")
//       .populate("buyer", "name email role")
//       .populate("releasedBy", "name email role")
//       .sort({ createdAt: -1 });

//     const totalVolume = escrows.reduce((sum, e) => sum + (e.amount || 0), 0);
//     const releasedVolume = escrows
//       .filter((e) => e.status === "released")
//       .reduce((sum, e) => sum + (e.amount || 0), 0);

//     return res.json({
//       success: true,
//       count: escrows.length,
//       totalVolume,
//       releasedVolume,
//       escrows,
//     });
//   } catch (err) {
//     console.error("getAgentEscrows error:", err);
//     return res.status(500).json({ success: false, message: err.message });
//   }
// };

// // ---------------------------
// // Change Escrow Status (Admin Only)
// // ---------------------------
// const changeEscrowStatus = async (req, res) => {
//   try {
//     // 🛡️ Admin protection check
//     if (!req.user || req.user.role !== "admin") {
//       return res.status(403).json({
//         success: false,
//         message: "Access denied. Only administrators can change escrow status.",
//       });
//     }

//     const { escrowId, status, reason, override } = req.body;
//     const adminId = req.user._id;

//     if (!escrowId || !status) {
//       return res
//         .status(400)
//         .json({ success: false, message: "Escrow ID and status are required" });
//     }

//     const allowedStatuses = ["on_hold", "released"];
//     if (!allowedStatuses.includes(status)) {
//       return res
//         .status(400)
//         .json({ success: false, message: "Invalid status value provided" });
//     }

//     const escrow = await Escrow.findById(escrowId);
//     if (!escrow) {
//       return res
//         .status(404)
//         .json({ success: false, message: "Escrow record not found" });
//     }

//     const previousStatus = escrow.status;

//     // 🛡️ Check for open disputes before allowing release
//     if (status === "released" && previousStatus !== "released") {
//       let openDispute = null;

//       // Query for an open dispute linked to the exact purchase or inspection
//       if (escrow.purchase) {
//         openDispute = await Dispute.findOne({
//           purchase: escrow.purchase,
//           status: { $in: ["open", "pending", "under_review"] }, // Adjust statuses based on your Dispute schema enum
//         });
//       } else if (escrow.inspection) {
//         openDispute = await Dispute.findOne({
//           inspection: escrow.inspection,
//           status: { $in: ["open", "pending", "under_review"] },
//         });
//       } else {
//         // Fallback query by property/buyer if IDs are missing
//         openDispute = await Dispute.findOne({
//           property: escrow.property,
//           buyer: escrow.buyer,
//           status: { $in: ["open", "pending", "under_review"] },
//         });
//       }

//       // If an open dispute exists, reject unless explicit override and reason are provided
//       if (openDispute) {
//         if (!override || !reason) {
//           return res.status(400).json({
//             success: false,
//             message:
//               "Cannot release escrow: An open dispute exists for this transaction. An explicit admin override flag and reason are required to proceed.",
//             disputeId: openDispute._id,
//           });
//         }
//       }
//     }

//     // 💰 If status is changing TO "released" (and wasn't already released)
//     if (status === "released" && previousStatus !== "released") {
//       const seller = await User.findById(escrow.seller);
//       if (!seller) {
//         return res
//           .status(404)
//           .json({ success: false, message: "Seller/Agent not found" });
//       }

//       // Credit seller wallet
//       seller.balance += escrow.amount;
//       await seller.save();

//       // 🔔 Notify seller that funds have been released
//       await Notification.create({
//         user: seller._id,
//         title: "Escrow Released",
//         message: `₦${escrow.amount} from escrow has been released and added to your wallet balance.`,
//         meta: { escrowId: escrow._id },
//       });

//       // 🔍 Update exact linked deal (Purchase or Inspection) feeReleased status
//       if (escrow.inspection) {
//         await Inspection.findByIdAndUpdate(escrow.inspection, {
//           feeReleased: true,
//         });
//       } else if (escrow.purchase) {
//         await Purchase.findByIdAndUpdate(escrow.purchase, {
//           feeReleased: true,
//         });
//       } else {
//         if (escrow.type === "inspection") {
//           await Inspection.findOneAndUpdate(
//             { property: escrow.property, user: escrow.buyer },
//             { feeReleased: true },
//           );
//         } else if (escrow.type === "purchase") {
//           await Purchase.findOneAndUpdate(
//             { property: escrow.property, buyer: escrow.buyer },
//             { feeReleased: true },
//           );
//         }
//       }

//       // Record release audit metadata (including override note if applicable)
//       escrow.releasedAt = new Date();
//       escrow.releasedBy = adminId;
//       escrow.reason =
//         reason ||
//         (override
//           ? "Released via admin override despite open dispute"
//           : "Funds released by admin");
//     }

//     // 🔄 Reverse safety: If it was released and admin changes it back, reverse balance & feeReleased
//     if (previousStatus === "released" && status !== "released") {
//       const seller = await User.findById(escrow.seller);
//       if (seller) {
//         seller.balance -= escrow.amount;
//         await seller.save();
//       }

//       if (escrow.inspection) {
//         await Inspection.findByIdAndUpdate(escrow.inspection, {
//           feeReleased: false,
//         });
//       } else if (escrow.purchase) {
//         await Purchase.findByIdAndUpdate(escrow.purchase, {
//           feeReleased: false,
//         });
//       } else {
//         if (escrow.type === "inspection") {
//           await Inspection.findOneAndUpdate(
//             { property: escrow.property, user: escrow.buyer },
//             { feeReleased: false },
//           );
//         } else if (escrow.type === "purchase") {
//           await Purchase.findOneAndUpdate(
//             { property: escrow.property, buyer: escrow.buyer },
//             { feeReleased: false },
//           );
//         }
//       }

//       // Clear audit metadata on reversal
//       escrow.releasedAt = null;
//       escrow.releasedBy = null;
//       escrow.reason = null;
//     }

//     // Update escrow status
//     escrow.status = status;
//     await escrow.save();

//     return res.json({
//       success: true,
//       message: `Escrow status updated to ${status} successfully`,
//       escrow,
//     });
//   } catch (err) {
//     console.error("changeEscrowStatus error:", err);
//     return res.status(500).json({ success: false, message: err.message });
//   }
// };

// // ---------------------------
// // 🛡️ Admin Refund Escrow (PATCH /escrow/:id/refund)
// // ---------------------------

// const refundEscrow = async (req, res) => {
//   try {
//     const { id } = req.params;
//     const { reason } = req.body;
//     const adminId = req.user._id;

//     // 1. Fetch the escrow record
//     const escrow = await Escrow.findById(id);
//     if (!escrow) {
//       return res.status(404).json({
//         success: false,
//         message: "Escrow record not found.",
//       });
//     }

//     // 2. Idempotency Check: Prevent repeated/double crediting
//     if (escrow.status === "refunded") {
//       return res.status(400).json({
//         success: false,
//         message: "This escrow transaction has already been refunded.",
//         escrow,
//       });
//     }

//     // 3. Atomically credit the buyer's wallet balance
//     const buyer = await User.findByIdAndUpdate(
//       escrow.buyer,
//       { $inc: { balance: escrow.amount } },
//       { new: true },
//     );

//     if (!buyer) {
//       return res.status(404).json({
//         success: false,
//         message: "Buyer associated with this escrow was not found.",
//       });
//     }

//     // 4. Update the Escrow document with status and audit metadata
//     escrow.status = "refunded";
//     escrow.releasedAt = new Date();
//     escrow.releasedBy = adminId;
//     escrow.reason = reason || "Refund processed by admin";
//     await escrow.save();

//     // 5. Clear exact linked deal's feeReleased status and set cancellation status
//     if (escrow.purchase) {
//       await Purchase.findByIdAndUpdate(escrow.purchase, {
//         status: "purchase_cancelled",
//         feeReleased: false,
//       });
//     } else if (escrow.inspection) {
//       await Inspection.findByIdAndUpdate(escrow.inspection, {
//         status: "inspection_cancelled",
//         feeReleased: false,
//       });
//     } else if (escrow.property && escrow.buyer) {
//       // Fallback for legacy escrows missing exact deal references
//       if (escrow.type === "purchase") {
//         await Purchase.findOneAndUpdate(
//           { property: escrow.property, buyer: escrow.buyer },
//           { status: "purchase_cancelled", feeReleased: false },
//         );
//       } else if (escrow.type === "inspection") {
//         await Inspection.findOneAndUpdate(
//           { property: escrow.property, user: escrow.buyer },
//           { status: "inspection_cancelled", feeReleased: false },
//         );
//       }
//     }

//     // 6. Record Transaction for buyer wallet history audit
//     await Transaction.create({
//       user: escrow.buyer,
//       amount: escrow.amount,
//       type: "escrow_refund",
//       status: "completed",
//       reference: escrow.reference || `REFUND-${Date.now()}`,
//       description: `Refund for escrow (${escrow.type || "transaction"}): ${escrow.reason}`,
//     });

//     // 7. Socket.io notification emission
//     if (global.io) {
//       global.io.emit("notification", {
//         type: "escrow_refunded",
//         title: "Escrow Refunded",
//         message: `An escrow payment of ₦${escrow.amount.toLocaleString()} has been refunded to your wallet.`,
//         userId: escrow.buyer,
//         escrowId: escrow._id,
//       });
//     }

//     return res.status(200).json({
//       success: true,
//       message: "Escrow successfully refunded to buyer's wallet.",
//       escrow,
//     });
//   } catch (err) {
//     console.error("refundEscrow error:", err);
//     return res.status(500).json({
//       success: false,
//       message: err.message || "An error occurred while refunding the escrow.",
//     });
//   }
// };

// module.exports = {
//   getAllEscrows,
//   getEscrowById,
//   getAgentEscrows,
//   changeEscrowStatus,
//   refundEscrow,
// };

// controllers/escrow.js
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

      if (escrow.purchase) {
        openDispute = await Dispute.findOne({
          purchase: escrow.purchase,
          status: { $in: ["open", "pending", "under_review"] },
        });
      } else if (escrow.inspection) {
        openDispute = await Dispute.findOne({
          inspection: escrow.inspection,
          status: { $in: ["open", "pending", "under_review"] },
        });
      } else {
        openDispute = await Dispute.findOne({
          property: escrow.property,
          buyer: escrow.buyer,
          status: { $in: ["open", "pending", "under_review"] },
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

      // 📝 Record the release in the agent’s wallet history / transactions
      await Transaction.create({
        user: seller._id,
        amount: payoutAmount,
        type: "escrow_release",
        status: "completed",
        reference: escrow.reference,
        meta: { escrowId: escrow._id, property: escrow.property },
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

        // Record reversal transaction in wallet history
        await Transaction.create({
          user: seller._id,
          amount: -payoutAmount,
          type: "escrow_release",
          status: "completed",
          reference: `rev-${escrow.reference}`,
          meta: { escrowId: escrow._id, note: "Escrow release reversed" },
        });

        // 🔌 Notify agent via socket on reversal as well
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

    await Transaction.create({
      user: escrow.buyer,
      amount: escrow.amount,
      type: "escrow_refund",
      status: "completed",
      reference: escrow.reference || `REFUND-${Date.now()}`,
      description: `Refund for escrow (${escrow.type || "transaction"}): ${escrow.reason}`,
    });

    if (global.io) {
      global.io.emit("notification", {
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
