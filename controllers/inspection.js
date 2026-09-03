const Inspection = require("../models/inspection");
const Property = require("../models/property");
const User = require("../models/user");
const Escrow = require("../models/escrow");
const Notification = require("../models/notification");
const generateCode = require("../middlewares/generateCode");
const {
  initializeTransaction,
  verifyTransaction,
} = require("../middlewares/paystack");
const crypto = require("crypto");

// ---------------------------
// 1️⃣ Request Inspection
// ---------------------------
const requestInspection = async (req, res) => {
  try {
    const { propertyId } = req.body;
    const userId = req.user._id;

    // Fetch property
    const property = await Property.findById(propertyId);
    if (!property)
      return res.status(404).json({ message: "Property not found" });

    // Generate 6-digit code
    const code = generateCode();

    // Create inspection record with status: "inspection_requested"
    const inspection = await Inspection.create({
      property: property._id,
      owner: property.owner,
      user: userId,
      code,
      fee: property.inspectionFee,
      status: "inspection_requested",
    });

    // Notification to user
    await Notification.create({
      user: userId,
      title: "Inspection Requested",
      message: `Inspection requested for "${property.title}". Use code ${code} to verify.`,
      meta: { inspectionId: inspection._id },
    });

    // Emit socket.io event
    if (global.io) {
      global.io.emit("notification", {
        type: "inspection_requested",
        title: "Inspection Requested",
        message: `Inspection requested for "${property.title}"`,
        inspectionId: inspection._id,
      });
    }

    res.status(201).json({
      success: true,
      message:
        "Inspection requested successfully. Proceed to payment/scheduling.",
      inspectionId: inspection._id,
      code, // remove in production
    });
  } catch (err) {
    console.error("requestInspection error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ---------------------------
// 3️⃣ Initialize Inspection Payment (Paystack)
// ---------------------------
const initializeInspectionPayment = async (req, res) => {
  try {
    const { inspectionId, callback_url } = req.body;
    const userId = req.user._id;

    const inspection = await Inspection.findById(inspectionId)
      .populate("owner")
      .populate("property");

    if (!inspection)
      return res.status(404).json({ message: "Inspection not found" });

    if (inspection.user.toString() !== userId.toString())
      return res.status(403).json({ message: "Unauthorized" });

    if (inspection.feePaid)
      return res.status(400).json({
        message: "Inspection fee already paid",
      });

    // Generate unique transaction reference
    const reference = crypto.randomBytes(16).toString("hex");

    // Update status to "inspection_scheduled" upon starting payment
    inspection.status = "inspection_scheduled";
    await inspection.save();

    // 🔔 Notifications
    await Notification.create({
      user: inspection.user,
      title: "Inspection Payment Started",
      message: `You initiated inspection payment. Escrow will be created upon successful payment.`,
      meta: { inspectionId },
    });

    await Notification.create({
      user: inspection.owner,
      title: "Incoming Inspection Payment",
      message: `A buyer has initiated payment for inspection of your property "${inspection.property?.title}".`,
      meta: { inspectionId },
    });

    if (global.io) {
      global.io.emit("notification", {
        type: "inspection_payment_started",
        title: "Inspection Payment Initiated",
        message: `A buyer has started inspection payment.`,
        inspectionId,
      });
    }

    // Initialize Paystack transaction
    const init = await initializeTransaction(
      req.user.email,
      inspection.fee * 100, // convert to kobo
      reference,
      callback_url,
    );

    return res.json({
      success: true,
      authorizationUrl: init.data.authorization_url,
      reference,
      inspectionId: inspection._id,
      callback_url,
    });
  } catch (err) {
    console.error("initializeInspectionPayment error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ---------------------------
// 4️⃣ Verify Inspection Payment (Paystack)
// ---------------------------
// const verifyInspectionPayment = async (req, res) => {
//   try {
//     const { reference, inspectionId } = req.body;

//     const verification = await verifyTransaction(reference);
//     if (verification.data.status !== "success") {
//       return res.status(400).json({ message: "Payment not successful" });s
//     }

//     // Find inspection
//     const inspection = await Inspection.findById(inspectionId)
//       .populate("owner")
//       .populate("property");

//     if (!inspection) {
//       return res.status(404).json({ message: "Inspection not found" });
//     }

//     // Prevent duplicate escrow creation if already verified
//     let escrow = await Escrow.findOne({ reference });
//     if (!escrow) {
//       // 👉 CREATE ESCROW ENTRY ONLY AFTER SUCCESSFUL PAYMENT VERIFICATION
//       escrow = await Escrow.create({
//         property: inspection.property?._id,
//         buyer: inspection.user,
//         seller: inspection.owner?._id,
//         amount: inspection.fee,
//         status: "pending", // Always pending for admin review/release later
//         reference,
//         type: "inspection",
//       });
//     }

//     // Find admin
//     const adminUser = await User.findOne({ role: "admin" });

//     // Update Inspection fields & change status to "inspection_confirmed"
//     inspection.feePaid = true;
//     inspection.escrowHeldBy = adminUser?._id;
//     inspection.status = "inspection_confirmed";
//     await inspection.save();

//     // 🔔 Notifications
//     await Notification.create({
//       user: inspection.user,
//       title: "Inspection Fee Paid",
//       message: `Your inspection fee has been paid successfully and is pending escrow review.`,
//       meta: { inspectionId, escrowId: escrow._id },
//     });

//     await Notification.create({
//       user: inspection.owner,
//       title: "Inspection Fee Received",
//       message: `The inspection fee for your property "${inspection.property?.title}" has been paid and confirmed.`,
//       meta: { inspectionId, escrowId: escrow._id },
//     });

//     if (adminUser) {
//       await Notification.create({
//         user: adminUser._id,
//         title: "New Escrow Created",
//         message: `A new inspection payment has been verified and an escrow is pending your review.`,
//         meta: { inspectionId, escrowId: escrow._id },
//       });
//     }

//     if (global.io) {
//       global.io.emit("notification", {
//         type: "inspection_fee_paid",
//         title: "Inspection Payment Confirmed",
//         message: `Inspection fee has been verified and escrow created.`,
//         inspectionId,
//         escrowId: escrow._id,
//       });
//     }

//     res.json({
//       success: true,
//       message:
//         "Payment verified, inspection confirmed, and escrow created successfully",
//       inspection,
//       escrow,
//     });
//   } catch (err) {
//     console.error("verifyInspectionPayment error:", err);
//     res.status(500).json({ success: false, message: err.message });
//   }
// };

// ---------------------------
// 🔄 Change Inspection Status (Admin Only)
// ---------------------------
const changeInspectionStatus = async (req, res) => {
  try {
    const { inspectionId } = req.params;
    const { status } = req.body;
    const adminId = req.user._id;

    // Allowed status transitions from your Inspection Schema enum
    // (Update these array strings to match your exact inspection schema enums if different)
    const allowedStatuses = [
      "none",
      "inspection_requested",
      "inspection_scheduled",
      "inspection_confirmed",
      "inspection_completed",
    ];

    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Invalid inspection status provided.",
      });
    }

    // Find inspection and populate necessary fields
    const inspection = await Inspection.findById(inspectionId)
      .populate("owner")
      .populate("property");

    if (!inspection) {
      return res
        .status(404)
        .json({ success: false, message: "Inspection not found" });
    }

    // Update inspection status
    inspection.status = status;
    inspection.escrowHeldBy = adminId;
    await inspection.save();

    // Optional business logic: If status means funds/escrow should be handled
    let escrow = await Escrow.findOne({
      property: inspection.property?._id,
      buyer: inspection.user,
      type: "inspection",
    });
    if (escrow && status === "inspection_confirmed") {
      // or whatever status releases/approves escrow
      escrow.status = "approved"; // or pending, depending on workflow
      await escrow.save();
    }

    // ------------------------------
    // NOTIFICATIONS
    // ------------------------------
    const formattedStatus = status.replace(/_/g, " ");
    const notificationMessage = `Your inspection status has been updated to: ${formattedStatus}.`;

    // Notify User/Buyer
    await Notification.create({
      user: inspection.user,
      title: "Inspection Status Updated",
      message: notificationMessage,
      meta: { inspectionId, status, escrowId: escrow?._id },
    });

    // Notify Property Owner/Agent
    if (inspection.owner) {
      await Notification.create({
        user: inspection.owner._id || inspection.owner,
        title: "Property Inspection Status Updated",
        message: `The inspection status for your property "${inspection.property?.title}" has changed to: ${formattedStatus}.`,
        meta: { inspectionId, status },
      });
    }

    // ------------------------------
    // SOCKET EVENT
    // ------------------------------
    if (global.io) {
      global.io.emit("notification", {
        type: "inspection_status_changed",
        title: "Inspection Status Updated",
        message: notificationMessage,
        inspectionId,
        status,
      });
    }

    res.json({
      success: true,
      message: `Inspection status successfully updated to ${status}`,
      inspection,
      escrow,
    });
  } catch (err) {
    console.error("changeInspectionStatus error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ---------------------------
// 5️⃣ Get Inspection Details
// ---------------------------
const getInspectionDetails = async (req, res) => {
  try {
    const { inspectionId } = req.params;

    const inspection = await Inspection.findById(inspectionId)
      .populate("property", "title price address")
      .populate("owner", "name email")
      .populate("user", "name email")
      .populate("escrowHeldBy", "name email");

    if (!inspection)
      return res.status(404).json({ message: "Inspection not found" });

    res.json({ success: true, inspection });
  } catch (err) {
    console.error("getInspectionDetails error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ---------------------------
// Get All Inspections for Logged-in User
// ---------------------------
const getUserInspections = async (req, res) => {
  try {
    const userId = req.user._id;

    const inspections = await Inspection.find({ user: userId })
      .populate("property", "title price address")
      .populate("owner", "name email")
      .populate("escrowHeldBy", "name email")
      .sort({ createdAt: -1 });

    res.json({ success: true, inspections });
  } catch (err) {
    console.error("getUserInspections error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// Get all inspections of properties managed by the logged-in agent
const getAgentInspections = async (req, res) => {
  try {
    const agentId = req.user._id;

    const properties = await Property.find(
      { agent: agentId },
      "_id title price address",
    );
    const propertyIds = properties.map((p) => p._id);

    const inspections = await Inspection.find({
      property: { $in: propertyIds },
    })
      .populate("property", "title price address")
      .populate("user", "name email")
      .populate("owner", "name email")
      .populate("escrowHeldBy", "name email")
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      properties,
      inspections,
    });
  } catch (err) {
    console.error("getAgentInspections error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// Get all inspections in the system
const getAllInspections = async (req, res) => {
  try {
    const inspections = await Inspection.find()
      .populate("property", "title price address")
      .populate("user", "name email")
      .populate("owner", "name email")
      .populate("escrowHeldBy", "name email")
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      inspections,
    });
  } catch (err) {
    console.error("getAllInspections error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = {
  requestInspection,
  initializeInspectionPayment,
  // verifyInspectionPayment,
  changeInspectionStatus,
  getInspectionDetails,
  getUserInspections,
  getAgentInspections,
  getAllInspections,
};
