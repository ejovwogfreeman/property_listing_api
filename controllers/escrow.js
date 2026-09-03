const Escrow = require("../models/escrow");
const User = require("../models/user");
const Notification = require("../models/notification");

// ---------------------------
// Get All Escrows (Admin Only)
// ---------------------------
const getAllEscrows = async (req, res) => {
  try {
    const escrows = await Escrow.find()
      .populate("property", "title location price")
      .populate("buyer", "name email role")
      .populate("seller", "name email role")
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
      .populate("seller", "name email role");

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
    // Allows looking up by param if admin, or defaulting to logged-in agent
    const agentId = req.params.agentId || req.user._id;

    const escrows = await Escrow.find({ seller: agentId })
      .populate("property", "title location price")
      .populate("buyer", "name email role")
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
    // 🛡️ Admin protection check
    if (!req.user || req.user.role !== "admin") {
      return res.status(403).json({
        success: false,
        message: "Access denied. Only administrators can change escrow status.",
      });
    }

    const { escrowId, status } = req.body;

    if (!escrowId || !status) {
      return res
        .status(400)
        .json({ success: false, message: "Escrow ID and status are required" });
    }

    const allowedStatuses = ["pending", "approved", "released", "cancelled"];
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

    // 💰 If status is changing TO "released" (and wasn't already released), credit the seller/agent wallet
    if (status === "released" && previousStatus !== "released") {
      const seller = await User.findById(escrow.seller);
      if (!seller) {
        return res
          .status(404)
          .json({ success: false, message: "Seller/Agent not found" });
      }

      seller.balance += escrow.amount;
      await seller.save();

      // 🔔 Notify seller that funds have been released
      await Notification.create({
        user: seller._id,
        title: "Escrow Released",
        message: `₦${escrow.amount} from escrow has been released and added to your wallet balance.`,
        meta: { escrowId: escrow._id },
      });
    }

    // 🔄 Reverse safety: If it was released and admin changes it back to pending/cancelled, reverse the balance
    if (previousStatus === "released" && status !== "released") {
      const seller = await User.findById(escrow.seller);
      if (seller) {
        seller.balance -= escrow.amount;
        await seller.save();
      }
    }

    // Update status
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

module.exports = {
  getAllEscrows,
  getEscrowById,
  getAgentEscrows,
  changeEscrowStatus,
};
