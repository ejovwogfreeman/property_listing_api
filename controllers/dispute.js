const Dispute = require("../models/dispute");
const Property = require("../models/property");
const Notification = require("../models/notification");

// ---------------------------
// 1️⃣ Open a New Dispute (User/Client)
// ---------------------------
const createDispute = async (req, res) => {
  try {
    const { propertyId, agentId, purchaseId, inspectionId, description } =
      req.body;
    const userId = req.user._id;

    // Verify property exists
    const property = await Property.findById(propertyId);
    if (!property) {
      return res
        .status(404)
        .json({ success: false, message: "Property not found" });
    }

    // Determine the defendant agent
    const targetAgentId = agentId || property.agent || property.owner;
    if (!targetAgentId) {
      return res
        .status(400)
        .json({
          success: false,
          message: "Associated agent could not be determined for this dispute.",
        });
    }

    // Create the dispute
    const dispute = await Dispute.create({
      property: propertyId,
      user: userId, // The user opening it
      agent: targetAgentId, // The agent being disputed
      purchase: purchaseId || undefined,
      inspection: inspectionId || undefined,
      description,
      openedAt: new Date(),
    });

    // Notify the Agent
    await Notification.create({
      user: targetAgentId,
      title: "New Dispute Opened",
      message: `A dispute has been opened regarding your property "${property.title}".`,
      meta: { disputeId: dispute._id, propertyId },
    });

    res.status(201).json({
      success: true,
      message: "Dispute opened successfully.",
      dispute,
    });
  } catch (err) {
    console.error("createDispute error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ---------------------------
// 2️⃣ Add Message to Dispute Thread (User, Agent, or Admin)
// ---------------------------
const addDisputeMessage = async (req, res) => {
  try {
    const { disputeId } = req.params;
    const { message } = req.body;
    const userId = req.user._id.toString();
    const userRole = req.user.role; // e.g., 'admin', 'user', 'agent'

    const dispute = await Dispute.findById(disputeId);
    if (!dispute) {
      return res
        .status(404)
        .json({ success: false, message: "Dispute not found" });
    }

    // 🔒 Authorization Check
    const isUser = dispute.user.toString() === userId;
    const isAgent = dispute.agent.toString() === userId;
    const isAdmin = userRole === "admin";

    if (!isUser && !isAgent && !isAdmin) {
      return res.status(403).json({
        success: false,
        message:
          "You are not authorized to participate in this dispute thread.",
      });
    }

    // If an admin is replying and no admin is assigned yet, auto-assign them
    if (isAdmin && !dispute.admin) {
      dispute.admin = req.user._id;
    }

    // Push the message into the embedded array
    dispute.messages.push({
      sender: req.user._id,
      message,
    });

    await dispute.save();

    // Determine who to notify
    let recipientIds = [];
    if (isUser) {
      recipientIds.push(dispute.agent);
      if (dispute.admin) recipientIds.push(dispute.admin);
    } else if (isAgent) {
      recipientIds.push(dispute.user);
      if (dispute.admin) recipientIds.push(dispute.admin);
    } else if (isAdmin) {
      recipientIds.push(dispute.user, dispute.agent);
    }

    // Dispatch notifications
    for (let recipientId of recipientIds) {
      if (recipientId) {
        await Notification.create({
          user: recipientId,
          title: "New Message in Dispute Ticket",
          message: `There is a new message in your dispute thread.`,
          meta: { disputeId: dispute._id },
        });
      }
    }

    res.json({
      success: true,
      message: "Message sent successfully.",
      dispute,
    });
  } catch (err) {
    console.error("addDisputeMessage error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ---------------------------
// 3️⃣ Update Dispute Status / Resolve (Admin only)
// ---------------------------
const updateDisputeStatus = async (req, res) => {
  try {
    const { disputeId } = req.params;
    const { status, resolutionNotes } = req.body;

    const dispute = await Dispute.findById(disputeId);
    if (!dispute) {
      return res
        .status(404)
        .json({ success: false, message: "Dispute not found" });
    }

    if (status) dispute.status = status;
    if (resolutionNotes) dispute.resolutionNotes = resolutionNotes;

    dispute.resolvedBy = req.user._id;
    if (!dispute.admin) {
      dispute.admin = req.user._id;
    }

    // Smart Timeline Tracking
    const now = new Date();
    if (status === "under_review" && !dispute.reviewedAt) {
      dispute.reviewedAt = now;
    }
    if (status === "resolved" && !dispute.resolvedAt) {
      dispute.resolvedAt = now;
    }
    if (status === "closed" && !dispute.closedAt) {
      dispute.closedAt = now;
    }

    await dispute.save();

    // Notify user and agent
    const participants = [dispute.user, dispute.agent];
    for (let participantId of participants) {
      await Notification.create({
        user: participantId,
        title: "Dispute Status Updated",
        message: `Your dispute status has been updated to: ${status.replace("_", " ")}.`,
        meta: { disputeId: dispute._id },
      });
    }

    res.json({
      success: true,
      message: "Dispute status updated successfully.",
      dispute,
    });
  } catch (err) {
    console.error("updateDisputeStatus error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ---------------------------
// 4️⃣ Get Single Dispute Details
// ---------------------------
const getDisputeDetails = async (req, res) => {
  try {
    const { disputeId } = req.params;

    const dispute = await Dispute.findById(disputeId)
      .populate("property", "title images price location")
      .populate("user", "name email phone")
      .populate("agent", "name email phone")
      .populate("admin", "name email")
      .populate("messages.sender", "name email role");

    if (!dispute) {
      return res
        .status(404)
        .json({ success: false, message: "Dispute not found" });
    }

    res.json({
      success: true,
      dispute,
    });
  } catch (err) {
    console.error("getDisputeDetails error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ---------------------------
// 5️⃣ Get Disputes for Logged-in User
// ---------------------------
const getMyDisputes = async (req, res) => {
  try {
    const userId = req.user._id;

    const disputes = await Dispute.find({ user: userId })
      .populate("property", "title images location price")
      .populate("agent", "name email phone")
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: disputes.length,
      disputes,
    });
  } catch (err) {
    console.error("getMyDisputes error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ---------------------------
// 6️⃣ Get Disputes for Logged-in Agent
// ---------------------------
const getAgentDisputes = async (req, res) => {
  try {
    const agentId = req.user._id;

    const disputes = await Dispute.find({ agent: agentId })
      .populate("property", "title images location price")
      .populate("user", "name email phone")
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: disputes.length,
      disputes,
    });
  } catch (err) {
    console.error("getAgentDisputes error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ---------------------------
// 7️⃣ Get All Disputes (Admin View)
// ---------------------------
const getAllDisputes = async (req, res) => {
  try {
    const { status, adminId } = req.query;

    let filter = {};
    if (status) filter.status = status;
    if (adminId) filter.admin = adminId;

    const disputes = await Dispute.find(filter)
      .populate("property", "title images location")
      .populate("user", "name email")
      .populate("agent", "name email")
      .populate("admin", "name email")
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: disputes.length,
      disputes,
    });
  } catch (err) {
    console.error("getAllDisputes error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = {
  createDispute,
  addDisputeMessage,
  updateDisputeStatus,
  getDisputeDetails,
  getMyDisputes,
  getAgentDisputes,
  getAllDisputes,
};
