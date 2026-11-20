const Purchase = require("../models/purchase");
const Inspection = require("../models/inspection");
const Escrow = require("../models/escrow");
const User = require("../models/user");
const Notification = require("../models/notification");

// A buyer has paid for the property (same list as controllers/property.js)
const TAKEN_STATUSES = [
  "property_payment_made",
  "handover_requested",
  "handover_scheduled",
  "handover_rescheduled",
  "handover_confirmed",
  "handover_completed",
  "funds_released",
];

const PROPERTY_TAKEN_MESSAGE =
  "Another buyer has paid for this property, so new inspections are paused. You can request one if it becomes available again.";

// Inspections that haven't finished. Completed ones are left alone: the agent
// did the visit, so the fee is still theirs.
const OPEN_INSPECTION_STATUSES = [
  "inspection_requested",
  "inspection_initialized",
  "inspection_payment_review",
  "inspection_paid",
  "inspection_scheduled",
  "inspection_confirmed",
];
const UNPAID_STATUSES = ["inspection_requested", "inspection_initialized"];

const notifyUser = (userId, data) => {
  try {
    if (global.io && userId) {
      global.io.to(userId.toString()).emit("notification", data);
    }
  } catch (err) {
    console.error("Socket notification error:", err);
  }
};

// True when a different buyer's payment holds this property (under review or
// approved), so this buyer can't start a new inspection.
const isPropertyTakenByOther = async (propertyId, userId) => {
  const taken = await Purchase.exists({
    property: propertyId,
    buyer: { $ne: userId },
    $or: [{ holdsProperty: true }, { status: { $in: TAKEN_STATUSES } }],
  });
  return !!taken;
};

// Called once an admin approves a purchase payment. Cancels the other buyers'
// open inspections on the property and refunds the paid ones in full, with no
// processing fee (cancelReason "property_taken" / escrow refundFeeWaived).
const cancelInspectionsForSoldProperty = async (purchase) => {
  const propertyId = purchase.property?._id || purchase.property;
  const buyerId = purchase.buyer?._id || purchase.buyer;
  const title = purchase.property?.title || "the property";

  const open = await Inspection.find({
    property: propertyId,
    user: { $ne: buyerId },
    status: { $in: OPEN_INSPECTION_STATUSES },
  });

  let refundsToSend = 0;

  for (const inspection of open) {
    try {
      const paid = !UNPAID_STATUSES.includes(inspection.status);
      const refundAmount = inspection.paidAmount || inspection.fee;
      const now = new Date();

      const set = {
        status: "inspection_cancelled",
        cancelReason: "property_taken",
        cancelledAt: now,
      };
      if (paid) {
        set.refundDue = true;
        set.refundAmount = refundAmount;
      }

      // only if it hasn't moved on in the meantime
      const claimed = await Inspection.findOneAndUpdate(
        { _id: inspection._id, status: inspection.status },
        { $set: set },
        { new: true },
      );
      if (!claimed) continue;

      // an approved fee sits in escrow: move it to refund pending
      if (paid) {
        refundsToSend += 1;
        await Escrow.findOneAndUpdate(
          { inspection: inspection._id, status: "on_hold" },
          {
            $set: {
              status: "refund_pending",
              reason: "Property secured by another buyer",
              refundApprovedAt: now,
              refundFeeWaived: true,
            },
          },
        );
      }

      const buyerMessage = paid
        ? `"${title}" has been secured by another buyer, so your inspection was cancelled. Your inspection fee of ₦${Number(refundAmount).toLocaleString()} will be refunded in full, with no processing fee.`
        : `"${title}" has been secured by another buyer, so your inspection request was cancelled. If you were paying at the time, the payment will be refunded in full.`;

      await Notification.create({
        user: inspection.user,
        title: "Inspection Cancelled",
        message: buyerMessage,
        meta: { inspectionId: inspection._id },
      });
      notifyUser(inspection.user, {
        type: "inspection_cancelled",
        title: "Inspection Cancelled",
        message: buyerMessage,
        inspectionId: inspection._id,
        status: "inspection_cancelled",
      });

      if (paid && inspection.owner) {
        const agentMessage = `An inspection for "${title}" was cancelled because the property has been secured by another buyer. That buyer's inspection fee will be refunded.`;
        await Notification.create({
          user: inspection.owner,
          title: "Inspection Cancelled",
          message: agentMessage,
          meta: { inspectionId: inspection._id },
        });
        notifyUser(inspection.owner, {
          type: "inspection_cancelled",
          title: "Inspection Cancelled",
          message: agentMessage,
          inspectionId: inspection._id,
          status: "inspection_cancelled",
        });
      }
    } catch (err) {
      console.error("cancelInspectionsForSoldProperty error:", err);
    }
  }

  if (refundsToSend > 0) {
    const admins = await User.find({ role: "admin" });
    for (const admin of admins) {
      const message = `${refundsToSend} inspection${refundsToSend > 1 ? "s were" : " was"} cancelled on "${title}" because the property was secured. Send the refund${refundsToSend > 1 ? "s" : ""} in full (no processing fee).`;
      await Notification.create({
        user: admin._id,
        title: "Refunds to Send",
        message,
      });
      notifyUser(admin._id, {
        type: "inspection_cancelled",
        title: "Refunds to Send",
        message,
      });
    }
  }
};

module.exports = {
  isPropertyTakenByOther,
  cancelInspectionsForSoldProperty,
  PROPERTY_TAKEN_MESSAGE,
};
