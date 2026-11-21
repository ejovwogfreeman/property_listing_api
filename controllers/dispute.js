const { Dispute, DisputeMessage } = require("../models/dispute");
const Inspection = require("../models/inspection");
const Purchase = require("../models/purchase");
const User = require("../models/user");
const Notification = require("../models/notification");
const { uploadImages } = require("../middlewares/cloudinary");

// Live push for a saved notification. Wrapped so a socket problem can never
// fail the request.
const notifyUser = (userId, event, data) => {
  try {
    if (global.io && userId) {
      global.io.to(userId.toString()).emit(event, data);
    }
  } catch (err) {
    console.error("Socket notification error:", err);
  }
};

// Saves a notification and pushes it live. `type` lets the frontend refresh
// the right pages (dispute_opened, dispute_updated, dispute_message).
const notify = async (userId, { title, message, type, disputeId }) => {
  if (!userId) return;
  await Notification.create({
    user: userId,
    title,
    message,
    meta: { disputeId },
  });
  notifyUser(userId, "notification", { type, title, message, disputeId });
};

const notifyAdmins = async (payload) => {
  const admins = await User.find({ role: "admin" }).select("_id");
  for (const admin of admins) await notify(admin._id, payload);
};

const OPEN_STATUSES = ["opened", "under_review", "escalated"];
const STATUSES = ["opened", "under_review", "resolved", "closed", "escalated"];
const RESOLUTIONS = ["buyer_favor", "agent_favor", "split", "dismissed"];
const CATEGORIES = [
  "refund_request",
  "property_mismatch",
  "agent_misconduct",
  "buyer_misconduct",
  "payment_issue",
  "other",
];

const STATUS_WORDS = {
  opened: "opened",
  under_review: "under review",
  resolved: "resolved",
  closed: "closed",
  escalated: "escalated",
};
const RESOLUTION_WORDS = {
  buyer_favor: "in the buyer's favour",
  agent_favor: "in the agent's favour",
  split: "with a split decision",
  dismissed: "dismissed",
};

const PERSON = "name email phoneNumber role profilePicture";

// Everything a dispute page needs, populated the same way everywhere.
const populateDispute = (query) =>
  query
    .populate("property", "title images location price listingType")
    .populate("user", PERSON)
    .populate("agent", PERSON)
    .populate("admin", PERSON)
    .populate("purchase")
    .populate("inspection");

const idOf = (v) => (v && v._id ? v._id : v)?.toString();

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
// 1️⃣ Open a New Dispute (buyer or agent of the deal)
// Body (multipart): purchaseId OR inspectionId, category, description,
//                   images[] (optional evidence)
// ---------------------------
const createDispute = async (req, res) => {
  try {
    const { purchaseId, inspectionId, category, description, priority } =
      req.body;
    const me = req.user._id.toString();

    // A dispute is always about one deal: the buyer and the agent come from
    // that record, never from the request, so either side can open it.
    if (!purchaseId && !inspectionId) {
      return res.status(400).json({
        success: false,
        message: "Open a dispute from a specific inspection or purchase.",
      });
    }

    const record = purchaseId
      ? await Purchase.findById(purchaseId).populate("property", "title agent")
      : await Inspection.findById(inspectionId).populate(
          "property",
          "title agent",
        );
    if (!record) {
      return res.status(404).json({
        success: false,
        message: purchaseId ? "Purchase not found." : "Inspection not found.",
      });
    }

    const buyerId = idOf(purchaseId ? record.buyer : record.user);
    const agentId = idOf(record.owner) || idOf(record.property?.agent);
    if (!buyerId || !agentId) {
      return res.status(400).json({
        success: false,
        message: "The buyer or agent of this deal could not be found.",
      });
    }

    const isBuyer = me === buyerId;
    const isAgent = me === agentId;
    if (!isBuyer && !isAgent) {
      return res.status(403).json({
        success: false,
        message:
          "Only the buyer or the agent of this deal can open a dispute on it.",
      });
    }

    const text = String(description || "").trim();
    if (!text) {
      return res
        .status(400)
        .json({ success: false, message: "Please describe the issue." });
    }
    const cat = CATEGORIES.includes(category) ? category : "other";

    // one open dispute per deal
    const existing = await Dispute.findOne({
      ...(purchaseId ? { purchase: purchaseId } : { inspection: inspectionId }),
      status: { $in: OPEN_STATUSES },
    });
    if (existing) {
      return res.status(400).json({
        success: false,
        message: `There is already an open dispute on this ${purchaseId ? "purchase" : "inspection"} (${existing.referenceId}). Our team will contact you about it.`,
        disputeId: existing._id,
      });
    }

    const disputeFiles = await extractAndUploadFiles(req.files);

    const dispute = await Dispute.create({
      property: idOf(record.property),
      user: buyerId,
      agent: agentId,
      openedBy: req.user._id,
      openedByRole: isAgent ? "agent" : "user",
      purchase: purchaseId || undefined,
      inspection: inspectionId || undefined,
      category: cat,
      description: text,
      disputeFiles,
      priority: ["low", "medium", "high"].includes(priority)
        ? priority
        : "medium",
      openedAt: new Date(),
    });

    const title = record.property?.title || "the property";

    // the other side of the deal
    await notify(isAgent ? buyerId : agentId, {
      type: "dispute_opened",
      title: "New Dispute Opened",
      message: `${isAgent ? "The agent" : "The buyer"} opened a dispute (${dispute.referenceId}) about "${title}". Our team will contact you.`,
      disputeId: dispute._id,
    });
    // the admins, who handle it
    await notifyAdmins({
      type: "dispute_opened",
      title: "New Dispute",
      message: `${dispute.referenceId}: ${isAgent ? "an agent" : "a buyer"} opened a dispute about "${title}".`,
      disputeId: dispute._id,
    });

    const populated = await populateDispute(Dispute.findById(dispute._id));

    res.status(201).json({
      success: true,
      message: "Dispute opened successfully.",
      dispute: populated,
    });
  } catch (err) {
    console.error("createDispute error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ---------------------------
// 2️⃣ Add Message to Dispute Thread (not used by the frontend yet)
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
      await dispute.save();
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

    for (const recipientId of recipientIds) {
      await notify(recipientId, {
        type: "dispute_message",
        title: "New Message in Dispute Ticket",
        message: `New message in ticket ${dispute.referenceId}.`,
        disputeId: dispute._id,
      });
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
// 3️⃣ Update Dispute Status & Outcome (Admin)
// Body: { status, resolution?, resolutionNotes?, payoutAccount? }
// Resolving needs an outcome (resolution) and notes: both are shown to the
// buyer and the agent. Moving money is separate (escrow pages).
// ---------------------------
const updateDisputeStatus = async (req, res) => {
  try {
    const { disputeId } = req.params;
    const { status, resolutionNotes, resolution, payoutAccount } = req.body;

    if (!STATUSES.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `status must be one of: ${STATUSES.join(", ")}.`,
      });
    }
    if (resolution && !RESOLUTIONS.includes(resolution)) {
      return res.status(400).json({
        success: false,
        message: `resolution must be one of: ${RESOLUTIONS.join(", ")}.`,
      });
    }

    const dispute = await Dispute.findById(disputeId);
    if (!dispute) {
      return res
        .status(404)
        .json({ success: false, message: "Dispute not found" });
    }

    const notes = String(resolutionNotes || "").trim();
    if (status === "resolved" && (!resolution || !notes)) {
      return res.status(400).json({
        success: false,
        message:
          "Choose an outcome and write the resolution notes to resolve a dispute.",
      });
    }
    if (dispute.status === "resolved" || dispute.status === "closed") {
      if (status !== "closed") {
        return res.status(400).json({
          success: false,
          message: "This dispute is already finished.",
        });
      }
    }

    dispute.status = status;
    if (notes) dispute.resolutionNotes = notes;
    if (resolution) dispute.resolution = resolution;
    if (payoutAccount) dispute.payoutAccount = payoutAccount;

    if (status === "resolved") dispute.resolvedBy = req.user._id;
    if (!dispute.admin) dispute.admin = req.user._id;

    const now = new Date();
    if (status === "under_review" && !dispute.reviewedAt)
      dispute.reviewedAt = now;
    if (status === "resolved" && !dispute.resolvedAt) dispute.resolvedAt = now;
    if (status === "closed" && !dispute.closedAt) dispute.closedAt = now;

    await dispute.save();

    const populatedDispute = await populateDispute(
      Dispute.findById(dispute._id),
    );

    const message =
      status === "resolved"
        ? `Your dispute (${dispute.referenceId}) was resolved ${RESOLUTION_WORDS[resolution]}. ${notes}`
        : `Your dispute (${dispute.referenceId}) is now ${STATUS_WORDS[status]}.`;

    for (const participantId of [dispute.user, dispute.agent]) {
      await notify(participantId, {
        type: "dispute_updated",
        title: "Dispute Status Updated",
        message,
        disputeId: dispute._id,
      });
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
// 3.1 Update Dispute Priority (Admin Only, not routed yet)
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

    const dispute = await populateDispute(
      Dispute.findByIdAndUpdate(disputeId, { priority }, { new: true }),
    );

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
// 4️⃣ Get Single Dispute Details (buyer, agent or admin only)
// ---------------------------
const getDisputeDetails = async (req, res) => {
  try {
    const { disputeId } = req.params;

    const dispute = await populateDispute(Dispute.findById(disputeId));

    if (!dispute) {
      return res
        .status(404)
        .json({ success: false, message: "Dispute not found" });
    }

    // only the two sides and the admins can read it (it carries both
    // people's contact details)
    const me = req.user._id.toString();
    const allowed =
      req.user.role === "admin" ||
      idOf(dispute.user) === me ||
      idOf(dispute.agent) === me;
    if (!allowed) {
      return res.status(403).json({
        success: false,
        message: "You don't have access to this dispute.",
      });
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
// 5️⃣ Get Disputes for Logged-in Buyer (opened by them, or by the agent
//     against them)
// ---------------------------
const getMyDisputes = async (req, res) => {
  try {
    const disputes = await populateDispute(
      Dispute.find({ user: req.user._id }),
    ).sort({ createdAt: -1 });

    res.status(200).json({ success: true, count: disputes.length, disputes });
  } catch (err) {
    console.error("getMyDisputes error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ---------------------------
// 6️⃣ Get Disputes for Logged-in Agent (opened by them, or by a buyer)
// ---------------------------
const getAgentDisputes = async (req, res) => {
  try {
    const disputes = await populateDispute(
      Dispute.find({ agent: req.user._id }),
    ).sort({ createdAt: -1 });

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

    const disputes = await populateDispute(Dispute.find(filter)).sort({
      createdAt: -1,
    });

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
