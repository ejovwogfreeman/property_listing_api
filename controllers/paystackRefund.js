const Escrow = require("../models/escrow");
const Inspection = require("../models/inspection");
const Purchase = require("../models/purchase");
const Transaction = require("../models/transaction");
const Notification = require("../models/notification");
const User = require("../models/user");
const { createRefund } = require("../middlewares/paystack");
const { calculateRefundFee } = require("../middlewares/platformFee");

const notifyUser = (userId, event, data) => {
  try {
    if (global.io && userId) {
      global.io.to(userId.toString()).emit(event, data);
    }
  } catch (err) {
    console.error("Socket notification error:", err);
  }
};

const naira = (n) => `₦${Number(n || 0).toLocaleString()}`;
const isTrue = (v) => v === true || v === "true";

// a Paystack refund that is being sent or already went through: a second
// one must not start
const REFUND_IN_FLIGHT = ["requesting", "pending", "processing", "processed"];

// ---------------------------
// 1. Escrow in refund_pending -> refund through Paystack
// POST /api/escrow/:id/paystack-refund
// Body: { waiveProcessingFee?: boolean, note?: string }
// ---------------------------
const refundEscrowViaPaystack = async (req, res) => {
  const { id } = req.params;
  const { waiveProcessingFee, note } = req.body || {};
  let claimed = false;

  try {
    const escrow = await Escrow.findById(id);
    if (!escrow) {
      return res
        .status(404)
        .json({ success: false, message: "Escrow not found." });
    }
    if (escrow.status !== "refund_pending") {
      return res.status(400).json({
        success: false,
        message:
          "Approve the refund first. Only escrows waiting to be refunded can be refunded through Paystack.",
      });
    }
    if (!escrow.reference) {
      return res.status(400).json({
        success: false,
        message:
          "This escrow has no Paystack payment reference. Send the refund manually.",
      });
    }

    const fee =
      isTrue(waiveProcessingFee) || escrow.refundFeeWaived
        ? 0
        : calculateRefundFee(escrow.amount);
    const amount = Math.max(0, (escrow.amount || 0) - fee);
    if (amount <= 0) {
      return res.status(400).json({
        success: false,
        message: "Nothing to refund after the processing fee.",
      });
    }

    // claim it, so two clicks can't start two Paystack refunds
    const lock = await Escrow.findOneAndUpdate(
      {
        _id: id,
        status: "refund_pending",
        paystackRefundStatus: { $nin: REFUND_IN_FLIGHT },
      },
      { $set: { paystackRefundStatus: "requesting" } },
      { new: true },
    );
    if (!lock) {
      return res.status(400).json({
        success: false,
        message: "A Paystack refund for this escrow is already in progress.",
      });
    }
    claimed = true;

    let refund;
    try {
      const result = await createRefund({
        reference: escrow.reference,
        amount,
        customerNote: "Refund from FindAHome",
        merchantNote: note || `Escrow refund ${escrow._id}`,
      });
      refund = result.data;
    } catch (err) {
      await Escrow.updateOne(
        { _id: id },
        { $set: { paystackRefundStatus: null } },
      );
      claimed = false;
      return res.status(400).json({
        success: false,
        message: `Paystack couldn't refund this payment: ${err.message}`,
      });
    }

    const now = new Date();
    const refundRef = `PSK-RF-${refund.id}`;

    const updated = await Escrow.findByIdAndUpdate(
      id,
      {
        $set: {
          status: "refunded",
          refundedAt: now,
          refundedAmount: amount,
          refundProcessingFee: fee,
          transferReference: refundRef,
          refundNote: note || null,
          refundMethod: "paystack",
          paystackRefundId: String(refund.id),
          paystackRefundStatus: refund.status || "pending",
          releasedAt: now,
          releasedBy: req.user._id,
        },
      },
      { new: true },
    );

    // ledger record (always our own unique reference)
    await Transaction.create({
      from: req.user._id,
      to: escrow.buyer,
      amount,
      type: "escrow_refund",
      status: "completed",
      reference: `${escrow.reference}-refund-${Date.now()}`,
    });

    const record = {
      refundDue: false,
      refundSentAt: now,
      refundSentAmount: amount,
      refundProcessingFee: fee,
      refundReference: refundRef,
      refundNote: note || null,
      refundMethod: "paystack",
      paystackRefundId: String(refund.id),
      paystackRefundStatus: refund.status || "pending",
    };
    if (escrow.purchase) {
      await Purchase.findByIdAndUpdate(escrow.purchase, record);
    } else if (escrow.inspection) {
      await Inspection.findByIdAndUpdate(escrow.inspection, record);
    }

    const message = `Your refund of ${naira(amount)} is on its way to the card or account you paid with${fee ? ` (a ${naira(fee)} processing fee was deducted)` : ""}. Banks usually take 3–10 working days.`;
    await Notification.create({
      user: escrow.buyer,
      title: "Refund Sent",
      message,
      meta: { escrowId: escrow._id },
    });
    notifyUser(escrow.buyer, "notification", {
      type: "escrow_refund_sent",
      title: "Refund Sent",
      message,
      escrowId: escrow._id,
    });

    return res.json({
      success: true,
      message: "Refund sent through Paystack.",
      escrow: updated,
      refund: { id: refund.id, status: refund.status, amount },
    });
  } catch (err) {
    console.error("refundEscrowViaPaystack error:", err);
    // never leave the escrow stuck in "requesting"
    if (claimed) {
      await Escrow.updateOne(
        { _id: id, paystackRefundStatus: "requesting" },
        { $set: { paystackRefundStatus: null } },
      ).catch(() => {});
    }
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ---------------------------
// 2. Rejected payment (refundDue) -> refund through Paystack
// POST /api/escrow/paystack-refund/:kind/:id   (kind: inspection | purchase)
// Body: { waiveProcessingFee?: boolean, note?: string }
// ---------------------------
const refundRecordViaPaystack = async (req, res) => {
  const { kind, id } = req.params;
  const { waiveProcessingFee, note } = req.body || {};
  const Model =
    kind === "purchase" ? Purchase : kind === "inspection" ? Inspection : null;
  let claimed = false;

  try {
    if (!Model) {
      return res.status(400).json({
        success: false,
        message: "kind must be 'inspection' or 'purchase'.",
      });
    }

    const record = await Model.findById(id);
    if (!record) {
      return res
        .status(404)
        .json({ success: false, message: `${kind} not found.` });
    }
    if (!record.refundDue) {
      return res.status(400).json({
        success: false,
        message: `No pending refund due for this ${kind}.`,
      });
    }
    if (!record.reference) {
      return res.status(400).json({
        success: false,
        message:
          "This payment has no Paystack reference. Send the refund manually.",
      });
    }

    const amountPaid =
      record.refundAmount ||
      record.paidAmount ||
      (kind === "purchase" ? record.price : record.fee);
    const fee =
      isTrue(waiveProcessingFee) ||
      (kind === "inspection" && record.cancelReason === "property_taken")
        ? 0
        : calculateRefundFee(amountPaid);
    const amount = Math.max(0, (amountPaid || 0) - fee);
    if (amount <= 0) {
      return res.status(400).json({
        success: false,
        message: "Nothing to refund after the processing fee.",
      });
    }

    const lock = await Model.findOneAndUpdate(
      {
        _id: id,
        refundDue: true,
        paystackRefundStatus: { $nin: REFUND_IN_FLIGHT },
      },
      { $set: { paystackRefundStatus: "requesting" } },
      { new: true },
    );
    if (!lock) {
      return res.status(400).json({
        success: false,
        message: "A Paystack refund for this payment is already in progress.",
      });
    }
    claimed = true;

    let refund;
    try {
      const result = await createRefund({
        reference: record.reference,
        amount,
        customerNote: "Refund from FindAHome",
        merchantNote: note || `Rejected ${kind} payment ${record._id}`,
      });
      refund = result.data;
    } catch (err) {
      await Model.updateOne(
        { _id: id },
        { $set: { paystackRefundStatus: null } },
      );
      claimed = false;
      return res.status(400).json({
        success: false,
        message: `Paystack couldn't refund this payment: ${err.message}`,
      });
    }

    const updated = await Model.findByIdAndUpdate(
      id,
      {
        $set: {
          refundDue: false,
          refundSentAt: new Date(),
          refundSentAmount: amount,
          refundProcessingFee: fee,
          refundReference: `PSK-RF-${refund.id}`,
          refundNote: note || null,
          refundMethod: "paystack",
          paystackRefundId: String(refund.id),
          paystackRefundStatus: refund.status || "pending",
        },
      },
      { new: true },
    );

    const buyer = kind === "purchase" ? record.buyer : record.user;
    const message = `Your refund of ${naira(amount)} is on its way to the card or account you paid with${fee ? ` (a ${naira(fee)} processing fee was deducted)` : ""}. Banks usually take 3–10 working days.`;
    await Notification.create({
      user: buyer,
      title:
        kind === "purchase" ? "Purchase Refund Sent" : "Inspection Refund Sent",
      message,
      meta: { [`${kind}Id`]: record._id },
    });
    notifyUser(buyer, "notification", {
      type: `${kind}_refund_sent`,
      title: "Refund Sent",
      message,
      [`${kind}Id`]: record._id,
    });

    return res.json({
      success: true,
      message: "Refund sent through Paystack.",
      [kind]: updated,
      refund: { id: refund.id, status: refund.status, amount },
    });
  } catch (err) {
    console.error("refundRecordViaPaystack error:", err);
    if (claimed && Model) {
      await Model.updateOne(
        { _id: id, paystackRefundStatus: "requesting" },
        { $set: { paystackRefundStatus: null } },
      ).catch(() => {});
    }
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ---------------------------
// 3. Paystack webhook: refund.pending / refund.processing / refund.processed / refund.failed
// Called from handlePaystackWebhook (controllers/inspection.js).
// ---------------------------
const handleRefundWebhook = async (event) => {
  const status = String(event.event || "").split(".")[1]; // processed, failed, ...
  const data = event.data || {};
  const reference = data.transaction_reference || data.transaction?.reference;
  if (!status || !reference) return;

  const escrow = await Escrow.findOne({ reference, refundMethod: "paystack" });
  const inspection = await Inspection.findOne({
    reference,
    refundMethod: "paystack",
  });
  const purchase = await Purchase.findOne({
    reference,
    refundMethod: "paystack",
  });
  if (!escrow && !inspection && !purchase) return;

  if (status !== "failed") {
    if (escrow)
      await Escrow.updateOne(
        { _id: escrow._id },
        { $set: { paystackRefundStatus: status } },
      );
    if (inspection)
      await Inspection.updateOne(
        { _id: inspection._id },
        { $set: { paystackRefundStatus: status } },
      );
    if (purchase)
      await Purchase.updateOne(
        { _id: purchase._id },
        { $set: { paystackRefundStatus: status } },
      );
    return;
  }

  // Failed: put everything back so the admin can try again (or send it by hand)
  if (escrow) {
    await Escrow.updateOne(
      { _id: escrow._id },
      {
        $set: {
          status: "refund_pending",
          refundMethod: null,
          paystackRefundStatus: "failed",
          refundedAt: null,
          refundedAmount: null,
          transferReference: null,
          releasedAt: null,
          releasedBy: null,
        },
      },
    );
    // the ledger record made when the refund was sent
    await Transaction.findOneAndUpdate(
      {
        type: "escrow_refund",
        reference: { $regex: `^${escrow.reference}-refund-` },
        status: "completed",
      },
      { $set: { status: "failed" } },
      { sort: { createdAt: -1 } },
    );
  }
  const reopen = {
    $set: {
      refundDue: true,
      refundSentAt: null,
      refundSentAmount: null,
      refundReference: null,
      refundMethod: null,
      paystackRefundStatus: "failed",
    },
  };
  if (inspection) await Inspection.updateOne({ _id: inspection._id }, reopen);
  if (purchase) await Purchase.updateOne({ _id: purchase._id }, reopen);

  // tell every admin, so someone sends it again or by hand
  const admins = await User.find({ role: "admin" }).select("_id");
  const message = `A Paystack refund for payment ${reference} failed. It is back under "Refunds to send": try again or send it manually.`;
  for (const admin of admins) {
    await Notification.create({
      user: admin._id,
      title: "Paystack Refund Failed",
      message,
      meta: {
        escrowId: escrow?._id,
        inspectionId: inspection?._id,
        purchaseId: purchase?._id,
      },
    });
    notifyUser(admin._id, "notification", {
      type: "escrow_refund_failed",
      title: "Paystack Refund Failed",
      message,
    });
  }
};

module.exports = {
  refundEscrowViaPaystack,
  refundRecordViaPaystack,
  handleRefundWebhook,
};
