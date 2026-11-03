const { Dispute, DisputeMessage } = require("../models/dispute");
const Property = require("../models/property");
const Notification = require("../models/notification");
const { uploadImages } = require("../middlewares/cloudinary");

// Robust helper to capture files regardless of multer configuration keys
const extractAndUploadFiles = async (reqFiles) => {
  if (!reqFiles) return [];
  let filesToUpload = [];

  if (Array.isArray(reqFiles)) {
    filesToUpload = reqFiles;
  } else {
    Object.values(reqFiles).forEach((fileArr) => {
      if (Array.isArray(fileArr)) {
        filesToUpload.push(...fileArr);
      }
    });
  }

  return filesToUpload.length > 0 ? await uploadImages(filesToUpload) : [];
};

// ---------------------------
// 1️⃣ Open a New Dispute
// ---------------------------
const createDispute = async (req, res) => {
  try {
    const {
      propertyId,
      agentId,
      purchaseId,
      inspectionId,
      category,
      description,
      priority,
    } = req.body;
    const userId = req.user._id;

    const property = await Property.findById(propertyId);
    if (!property) {
      return res
        .status(404)
        .json({ success: false, message: "Property not found" });
    }

    const targetAgentId = agentId || property.agent || property.owner;
    if (!targetAgentId) {
      return res.status(400).json({
        success: false,
        message: "Associated agent could not be determined for this dispute.",
      });
    }

    const disputeFiles = await extractAndUploadFiles(req.files);

    const dispute = await Dispute.create({
      property: propertyId,
      user: userId,
      agent: targetAgentId,
      purchase: purchaseId || undefined,
      inspection: inspectionId || undefined,
      category: category || "other",
      description,
      disputeFiles,
      priority: priority || "medium",
      openedAt: new Date(),
    });

    await Notification.create({
      user: targetAgentId,
      title: "New Dispute Opened",
      message: `A dispute (${dispute.referenceId}) has been opened regarding your property "${property.title}".`,
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
// 2️⃣ Add Message to Dispute Thread
// ---------------------------
const addDisputeMessage = async (req, res) => {
  try {
    const { disputeId } = req.params;
    const { text, type } = req.body;
    const userId = req.user._id.toString();
    const userRole = req.user.role;

    const dispute = await Dispute.findById(disputeId);
    if (!dispute) {
      return res
        .status(404)
        .json({ success: false, message: "Dispute not found" });
    }

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

    if (isAdmin && !dispute.admin) {
      dispute.admin = req.user._id;
    }

    const attachments = await extractAndUploadFiles(req.files);

    let messageType = type || "text";
    if (attachments.length > 0 && !text) {
      messageType =
        attachments.length === 1 &&
        attachments[0].match(/\.(jpg|jpeg|png|webp|gif)$/i)
          ? "image"
          : "file";
    }

    const newMessage = await DisputeMessage.create({
      dispute: disputeId,
      sender: req.user._id,
      text: text || "",
      attachments,
      type: messageType,
      readBy: [req.user._id],
    });

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

    for (let recipientId of recipientIds) {
      if (recipientId) {
        await Notification.create({
          user: recipientId,
          title: "New Message in Dispute Ticket",
          message: `New message in ticket ${dispute.referenceId}.`,
          meta: { disputeId: dispute._id, messageId: newMessage._id },
        });
      }
    }

    res.status(201).json({
      success: true,
      message: "Message sent successfully.",
      data: newMessage,
    });
  } catch (err) {
    console.error("addDisputeMessage error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ---------------------------
// 3️⃣ Update Dispute Status, Outcome & Manual Payout Account
// ---------------------------
const updateDisputeStatus = async (req, res) => {
  try {
    const { disputeId } = req.params;
    const { status, resolutionNotes, resolution, payoutAccount } = req.body;

    const dispute = await Dispute.findById(disputeId);
    if (!dispute) {
      return res
        .status(404)
        .json({ success: false, message: "Dispute not found" });
    }

    if (status) dispute.status = status;
    if (resolutionNotes) dispute.resolutionNotes = resolutionNotes;
    if (resolution) dispute.resolution = resolution;
    if (payoutAccount) dispute.payoutAccount = payoutAccount;

    dispute.resolvedBy = req.user._id;
    if (!dispute.admin) {
      dispute.admin = req.user._id;
    }

    const now = new Date();
    if (status === "under_review" && !dispute.reviewedAt)
      dispute.reviewedAt = now;
    if (status === "resolved" && !dispute.resolvedAt) dispute.resolvedAt = now;
    if (status === "closed" && !dispute.closedAt) dispute.closedAt = now;

    await dispute.save();

    const populatedDispute = await Dispute.findById(dispute._id)
      .populate("property", "title images location price")
      .populate("user", "name email phoneNumber role profilePicture")
      .populate("agent", "name email phoneNumber role profilePicture")
      .populate("admin", "name email phoneNumber role profilePicture")
      .populate("purchase")
      .populate("inspection");

    const participants = [dispute.user, dispute.agent];
    for (let participantId of participants) {
      if (participantId) {
        await Notification.create({
          user: participantId,
          title: "Dispute Status Updated",
          message: `Your dispute (${dispute.referenceId}) status changed to: ${status.replace("_", " ")}.`,
          meta: { disputeId: dispute._id },
        });
      }
    }

    res.json({
      success: true,
      message: "Dispute status and resolution updated successfully.",
      dispute: populatedDispute,
    });
  } catch (err) {
    console.error("updateDisputeStatus error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ---------------------------
// 3.1 Update Dispute Priority (Admin Only)
// ---------------------------
const updateDisputePriority = async (req, res) => {
  try {
    if (!req.user || req.user.role !== "admin") {
      return res.status(403).json({
        success: false,
        message:
          "Access denied. Only administrators can update dispute priority.",
      });
    }

    const { disputeId } = req.params;
    const { priority } = req.body;

    const allowedPriorities = ["low", "medium", "high"];
    if (!priority || !allowedPriorities.includes(priority)) {
      return res.status(400).json({
        success: false,
        message:
          "Invalid or missing priority. Must be 'low', 'medium', or 'high'.",
      });
    }

    const dispute = await Dispute.findByIdAndUpdate(
      disputeId,
      { priority },
      { new: true },
    )
      .populate("property", "title images location price")
      .populate("user", "name email phoneNumber role profilePicture")
      .populate("agent", "name email phoneNumber role profilePicture")
      .populate("admin", "name email phoneNumber role profilePicture");

    if (!dispute) {
      return res.status(404).json({
        success: false,
        message: "Dispute not found",
      });
    }

    return res.json({
      success: true,
      message: `Dispute priority successfully updated to ${priority}`,
      dispute,
    });
  } catch (err) {
    console.error("updateDisputePriority error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ---------------------------
// 4️⃣ Get Single Dispute Details (Fully Populated)
// ---------------------------
const getDisputeDetails = async (req, res) => {
  try {
    const { disputeId } = req.params;

    const dispute = await Dispute.findById(disputeId)
      .populate("property", "title images location price")
      .populate("user", "name email phoneNumber role profilePicture")
      .populate("agent", "name email phoneNumber role profilePicture")
      .populate("admin", "name email phoneNumber role profilePicture")
      .populate("purchase")
      .populate("inspection");

    if (!dispute) {
      return res
        .status(404)
        .json({ success: false, message: "Dispute not found" });
    }

    const messages = await DisputeMessage.find({ dispute: disputeId })
      .populate("sender", "name email role")
      .sort({ createdAt: 1 });

    res.json({
      success: true,
      dispute,
      messages,
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
      .populate("agent", "name email phoneNumber role profilePicture")
      .populate("purchase")
      .populate("inspection")
      .sort({ createdAt: -1 });

    res.status(200).json({ success: true, count: disputes.length, disputes });
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
      .populate("user", "name email phoneNumber role profilePicture")
      .populate("purchase")
      .populate("inspection")
      .sort({ createdAt: -1 });

    res.status(200).json({ success: true, count: disputes.length, disputes });
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
      .populate("property", "title images location price")
      .populate("user", "name email phoneNumber role profilePicture")
      .populate("agent", "name email phoneNumber role profilePicture")
      .populate("admin", "name email phoneNumber role profilePicture")
      .populate("purchase")
      .populate("inspection")
      .sort({ createdAt: -1 });

    res.status(200).json({ success: true, count: disputes.length, disputes });
  } catch (err) {
    console.error("getAllDisputes error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = {
  createDispute,
  addDisputeMessage,
  updateDisputeStatus,
  updateDisputePriority,
  getDisputeDetails,
  getMyDisputes,
  getAgentDisputes,
  getAllDisputes,
};
