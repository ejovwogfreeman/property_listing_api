# Backend: notifications

Built from the current backend (`3c1c87f`). Each file below is the **complete file**: replace the whole file with it.

The frontend now has a notification bell for buyers, agents and admins. Clicking a notification opens the page it is about, using the ids in `meta`. Two backend changes make that work properly.

## 1. Payouts: save a notification when a withdrawal is paid or declined (needed)

When the admin pays or declines a withdrawal, `changeTransactionStatus` only sends a live socket event (_"Transaction Status Updated"_). Nothing is saved. An agent who isn't online at that moment never learns that their payout was sent, or that it was declined and the money returned.

**The fix:** it now also saves a notification, with a clear title and message:

| Change                           | Title                      | Message                                                                    |
| -------------------------------- | -------------------------- | -------------------------------------------------------------------------- |
| withdrawal approved              | Withdrawal Paid            | Your withdrawal of ₦50,000 has been sent to GTBank (••••••1234).           |
| withdrawal declined / failed     | Withdrawal Declined        | Your withdrawal of ₦50,000 was declined. The money is back in your wallet. |
| wallet funding approved          | Wallet Funded              | ₦20,000 has been added to your wallet.                                     |
| wallet funding declined / failed | Wallet Funding Declined    | Your wallet funding of ₦20,000 could not be confirmed.                     |
| anything else                    | Transaction Status Updated | Your agent payment of ₦… is now approved.                                  |

`meta.transactionId` is set, so the agent's bell opens their wallet. The live event still goes out, now with the same title and message. Only the end of `changeTransactionStatus` changes.

## 2. Listing views: stop saving a notification per view, and stop broadcasting it (strongly recommended)

Every time someone opens a listing, `getProperty` does two things:

- **Saves a "Property Viewed" notification** for the agent. On a busy listing that means hundreds of notifications that bury the ones that matter (payments, inspections, disputes). The frontend now hides them, but they still fill the database.
- **Sends the live event to every connected user** on the platform (`global.io.emit`), not just the agent who owns the listing. Every buyer, agent and admin receives it for every view, which is wasted traffic and lets anyone see which listings are being viewed.

**The fix:** the view is no longer saved as a notification, and the live event goes only to the owner (`global.io.to(ownerId)`). If you want to show agents how many views a listing gets, a view counter on the property is the better tool. Nothing else in `property.js` changes.

## Files

### `controllers/transaction.js`

```js
const User = require("../models/user");
const Notification = require("../models/notification");
const Transaction = require("../models/transaction");
const Inspection = require("../models/inspection");
const Purchase = require("../models/purchase");
const Escrow = require("../models/escrow");
const {
  initializeTransaction,
  verifyTransaction,
} = require("../middlewares/paystack");
const crypto = require("crypto");

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
// 1️⃣ Wallet Funding: Initializes Paystack WITHOUT creating a premature Transaction
// ---------------------------
const walletFunding = async (req, res) => {
  try {
    const { amount, callback_url } = req.body;
    const userId = req.user._id;

    if (!amount || amount <= 0) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid amount" });
    }

    const reference = crypto.randomBytes(16).toString("hex");
    const amountInKobo = Math.round(amount * 100);

    // Initialize Paystack with metadata for webhook/callback tracking
    const init = await initializeTransaction(
      req.user.email,
      amountInKobo,
      reference,
      callback_url,
      { userId: userId.toString(), purpose: "wallet_funding" },
    );

    if (!init || !init.status || !init.data?.authorization_url) {
      return res.status(400).json({
        success: false,
        message: "Failed to initialize Paystack transaction.",
      });
    }

    return res.json({
      success: true,
      authorizationUrl: init.data.authorization_url,
      reference,
      callback_url,
    });
  } catch (err) {
    console.error("walletFunding error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ---------------------------
// 1️⃣.1 Confirm Wallet Funding (User callback / Webhook helper)
// ---------------------------
// const confirmFundWallet = async (req, res) => {
//   try {
//     const { reference } = req.body;
//     const userId = req.user._id;

//     if (!reference) {
//       return res
//         .status(400)
//         .json({ success: false, message: "Reference is required" });
//     }

//     const verification = await verifyTransaction(reference);
//     if (!verification || verification.data.status !== "success") {
//       return res.status(400).json({
//         success: false,
//         message: "Payment not successful or verification failed",
//       });
//     }

//     // Check metadata ownership
//     const meta = verification.data.metadata || {};
//     const metaUserId = meta.userId;
//     if (
//       meta.purpose !== "wallet_funding" ||
//       !metaUserId ||
//       (metaUserId !== userId.toString() && req.user.role !== "admin")
//     ) {
//       return res
//         .status(403)
//         .json({ success: false, message: "Unauthorized transaction owner" });
//     }

//     const targetUserId = metaUserId || userId;
//     const paidAmount = verification.data.amount / 100;

//     // Idempotency: check if transaction already exists
//     let transaction = await Transaction.findOne({ reference });
//     if (transaction) {
//       return res.json({
//         success: true,
//         status: transaction.status,
//         message: "Transaction already recorded.",
//         transaction,
//       });
//     }

//     // Create pending transaction awaiting admin approval
//     try {
//       transaction = await Transaction.create({
//         from: targetUserId,
//         to: targetUserId,
//         amount: paidAmount,
//         type: "wallet_funding",
//         status: "pending",
//         reference,
//       });
//     } catch (createErr) {
//       if (createErr.code === 11000) {
//         transaction = await Transaction.findOne({ reference });
//         return res.json({
//           success: true,
//           status: transaction.status,
//           transaction,
//         });
//       }
//       throw createErr;
//     }

//     await Notification.create({
//       user: targetUserId,
//       title: "Wallet Funding Payment Received",
//       message: `Your payment of ₦${paidAmount} was received and is pending admin approval.`,
//       meta: { transactionId: transaction._id },
//     });

//     notifyUser(targetUserId, "notification", {
//       type: "wallet_funding_pending",
//       title: "Wallet Funding Pending Review",
//       message: `Your wallet funding payment is awaiting admin approval.`,
//       transactionId: transaction._id,
//     });

//     return res.json({
//       success: true,
//       status: "pending",
//       message: "Payment verified and submitted for admin approval.",
//       transaction,
//     });
//   } catch (err) {
//     console.error("confirmFundWallet error:", err);
//     return res.status(500).json({ success: false, message: err.message });
//   }
// };

// Paystack may return metadata as an object or as a JSON string
const parseMetadata = (metadata) => {
  if (!metadata) return {};
  if (typeof metadata === "string") {
    try {
      return JSON.parse(metadata);
    } catch {
      return {};
    }
  }
  return metadata;
};

// Records a successful Paystack wallet funding as a pending Transaction for
// the admin to approve. Used by confirmFundWallet and the Paystack webhook.
// requesterId: the logged-in user (null for the webhook or an admin).
// Throws an error with .status for "not a wallet funding" / "not yours".
const recordWalletFunding = async (reference, paystackData, requesterId) => {
  const meta = parseMetadata(paystackData.metadata);
  if (meta.purpose !== "wallet_funding" || !meta.userId) {
    const err = new Error("This payment is not a wallet funding.");
    err.status = 400;
    throw err;
  }
  if (requesterId && meta.userId !== requesterId.toString()) {
    const err = new Error("Unauthorized transaction owner");
    err.status = 403;
    throw err;
  }

  // Idempotency: callback and webhook can both arrive
  const existing = await Transaction.findOne({ reference });
  if (existing) return { transaction: existing, created: false };

  const paidAmount = paystackData.amount / 100;
  let transaction;
  try {
    transaction = await Transaction.create({
      from: meta.userId,
      to: meta.userId,
      amount: paidAmount,
      type: "wallet_funding",
      status: "pending",
      reference,
    });
  } catch (createErr) {
    if (createErr.code === 11000) {
      return {
        transaction: await Transaction.findOne({ reference }),
        created: false,
      };
    }
    throw createErr;
  }

  await Notification.create({
    user: meta.userId,
    title: "Wallet Funding Payment Received",
    message: `Your payment of ₦${paidAmount} was received and is pending admin approval.`,
    meta: { transactionId: transaction._id },
  });

  notifyUser(meta.userId, "notification", {
    type: "wallet_funding_pending",
    title: "Wallet Funding Pending Review",
    message: `Your wallet funding payment is awaiting admin approval.`,
    transactionId: transaction._id,
  });

  // tell the admins: the reports page (and its sidebar count) refreshes on this
  const funder = await User.findById(meta.userId).select("name");
  const fundingAdmins = await User.find({ role: "admin" }).select("_id");
  const fundingMessage = `${funder?.name || "An agent"} funded their wallet with ₦${paidAmount.toLocaleString()}. Confirm the payment to add it to their balance.`;
  for (const admin of fundingAdmins) {
    await Notification.create({
      user: admin._id,
      title: "Wallet Funding to Confirm",
      message: fundingMessage,
      meta: { transactionId: transaction._id },
    });
    notifyUser(admin._id, "notification", {
      type: "wallet_funding_pending",
      title: "Wallet Funding to Confirm",
      message: fundingMessage,
      transactionId: transaction._id,
    });
  }

  return { transaction, created: true };
};

// ---------------------------
// 1️⃣.1 Confirm Wallet Funding (agent's return from Paystack)
// ---------------------------
const confirmFundWallet = async (req, res) => {
  try {
    const { reference } = req.body;

    if (!reference) {
      return res
        .status(400)
        .json({ success: false, message: "Reference is required" });
    }

    let verification;
    try {
      verification = await verifyTransaction(reference);
    } catch (netErr) {
      // Paystack unreachable: the webhook will record it
      console.error("Paystack network error during wallet confirm:", netErr);
      return res.json({ success: true, status: "processing" });
    }

    if (!verification || verification.data.status !== "success") {
      return res.status(400).json({
        success: false,
        message: "Payment not successful or verification failed",
      });
    }

    const requesterId = req.user.role === "admin" ? null : req.user._id;
    const { transaction, created } = await recordWalletFunding(
      reference,
      verification.data,
      requesterId,
    );

    return res.json({
      success: true,
      status: transaction.status,
      message: created
        ? "Payment verified and submitted for admin approval."
        : "Transaction already recorded.",
      transaction,
    });
  } catch (err) {
    if (err.status) {
      return res
        .status(err.status)
        .json({ success: false, message: err.message });
    }
    console.error("confirmFundWallet error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ---------------------------
// 2️⃣ Verify Wallet Funding (Admin Approval - Atomic & Idempotent)
// ---------------------------
const verifyWalletFunding = async (req, res) => {
  try {
    const { reference } = req.body;

    if (!reference) {
      return res.status(400).json({ message: "Reference is required" });
    }

    const transaction = await Transaction.findOne({ reference });
    if (!transaction) {
      return res.status(404).json({ message: "Transaction not found" });
    }

    if (transaction.type !== "wallet_funding") {
      return res.status(400).json({ message: "Invalid transaction type" });
    }

    // Idempotency: already approved returns 200 gracefully
    if (
      transaction.status === "approved" ||
      transaction.status === "completed"
    ) {
      const user = await User.findById(transaction.to);
      return res.status(200).json({
        success: true,
        message: "Transaction already approved and credited.",
        balance: user?.balance,
        transaction,
      });
    }

    const verification = await verifyTransaction(reference);
    if (!verification || verification.data.status !== "success") {
      return res
        .status(400)
        .json({ message: "Paystack payment verification failed." });
    }

    const expectedAmountInKobo = Math.round(transaction.amount * 100);
    if (verification.data.amount !== expectedAmountInKobo) {
      return res.status(400).json({
        message: "Amount mismatch between transaction and Paystack record.",
      });
    }

    // Atomic credit with $inc to prevent double-crediting
    const user = await User.findByIdAndUpdate(
      transaction.to,
      { $inc: { balance: transaction.amount } },
      { new: true },
    );

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    transaction.status = "approved";
    transaction.approvedAt = new Date();
    await transaction.save();

    await Notification.create({
      user: user._id,
      title: "Wallet Funded",
      message: `₦${transaction.amount} has been added to your wallet successfully by admin.`,
      meta: { transactionId: transaction._id },
    });

    notifyUser(user._id, "notification", {
      type: "wallet_funded",
      title: "Wallet Credited",
      message: `₦${transaction.amount} has been credited to your wallet.`,
      balance: user.balance,
      transactionId: transaction._id,
    });

    return res.json({
      success: true,
      message: "Wallet funded successfully",
      balance: user.balance,
      transaction,
    });
  } catch (err) {
    console.error("verifyWalletFunding error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

const payAgent = async (req, res) => {
  try {
    const { agentId, amount } = req.body;
    const adminId = req.user._id;

    if (!agentId || !amount || amount <= 0) {
      return res
        .status(400)
        .json({ message: "Agent and valid amount are required" });
    }

    // Atomic agent balance credit
    const agent = await User.findByIdAndUpdate(
      agentId,
      { $inc: { balance: amount } },
      { new: true },
    );

    if (!agent) {
      return res.status(404).json({ message: "Agent not found" });
    }

    const reference = crypto.randomBytes(16).toString("hex");

    const transaction = await Transaction.create({
      from: adminId,
      to: agentId,
      amount,
      type: "agent_payment",
      status: "approved",
      reference,
      approvedAt: new Date(),
    });

    await Notification.create({
      user: agentId,
      title: "You received a payment",
      message: `You have been paid ₦${amount} by admin.`,
      meta: { transactionId: transaction._id },
    });

    notifyUser(agentId, "notification", {
      type: "agent_payment",
      title: "Agent Paid",
      message: `You received ₦${amount} from admin.`,
      balance: agent.balance,
      transactionId: transaction._id,
    });

    return res.json({
      success: true,
      message: "Agent paid successfully",
      transaction,
      balance: agent.balance,
    });
  } catch (err) {
    console.error("payAgent error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ---------------------------
// 3️⃣ Change Transaction Status (Safely handles withdrawal refunds once)
// ---------------------------
const changeTransactionStatus = async (req, res) => {
  try {
    const { transactionId, status } = req.body;

    if (!["pending", "approved", "declined", "failed"].includes(status)) {
      return res.status(400).json({ message: "Invalid status" });
    }

    const transaction = await Transaction.findById(transactionId);
    if (!transaction) {
      return res.status(404).json({ message: "Transaction not found" });
    }

    const previousStatus = transaction.status;
    if (previousStatus === status) {
      return res.json({
        success: true,
        message: `Transaction is already ${status}`,
        transaction,
      });
    }

    // A declined or failed withdrawal has already given the money back, so
    // it can't be changed again (that would pay it back a second time)
    const FINAL = ["failed", "declined"];
    if (transaction.type === "withdrawal" && FINAL.includes(previousStatus)) {
      return res.status(400).json({
        message:
          "This withdrawal was already declined and the money returned to the agent.",
      });
    }

    // Claim the change atomically so two clicks can't both apply it
    const claimed = await Transaction.findOneAndUpdate(
      { _id: transaction._id, status: previousStatus },
      {
        $set: {
          status,
          ...(status === "approved" ? { approvedAt: new Date() } : {}),
        },
      },
      { new: true },
    );
    if (!claimed) {
      return res.status(409).json({
        message:
          "This transaction was just changed by someone else. Refresh and try again.",
      });
    }

    const targetUserId = transaction.to || transaction.from;

    // How much the user's balance moves
    let delta = 0;
    if (transaction.type === "withdrawal") {
      // The amount was taken at request time. Approving changes nothing
      // (the admin pays offline); declining or failing gives it back once.
      if (FINAL.includes(status)) delta = transaction.amount;
    } else if (previousStatus === "approved") {
      // wallet funding / agent payment reversed
      delta = -transaction.amount;
    } else if (status === "approved") {
      delta = transaction.amount;
    }

    const user = delta
      ? await User.findByIdAndUpdate(
          targetUserId,
          { $inc: { balance: delta } },
          { new: true },
        )
      : await User.findById(targetUserId);

    // a saved notification as well as the live event, so an agent who is
    // offline still learns their payout was sent or declined
    const naira = (n) => `₦${Number(n || 0).toLocaleString()}`;
    const bank = transaction.bankDetails?.bankName
      ? ` to ${transaction.bankDetails.bankName}${
          transaction.bankDetails.accountNumber
            ? ` (${String(transaction.bankDetails.accountNumber).slice(-4).padStart(10, "•")})`
            : ""
        }`
      : "";
    let title = "Transaction Status Updated";
    let message = `Your ${transaction.type.replace(/_/g, " ")} of ${naira(transaction.amount)} is now ${status}.`;
    if (transaction.type === "withdrawal" && status === "approved") {
      title = "Withdrawal Paid";
      message = `Your withdrawal of ${naira(transaction.amount)} has been sent${bank}.`;
    } else if (transaction.type === "withdrawal" && FINAL.includes(status)) {
      title = "Withdrawal Declined";
      message = `Your withdrawal of ${naira(transaction.amount)} was declined. The money is back in your wallet.`;
    } else if (transaction.type === "wallet_funding" && status === "approved") {
      title = "Wallet Funded";
      message = `${naira(transaction.amount)} has been added to your wallet.`;
    } else if (
      transaction.type === "wallet_funding" &&
      FINAL.includes(status)
    ) {
      title = "Wallet Funding Declined";
      message = `Your wallet funding of ${naira(transaction.amount)} could not be confirmed.`;
    }

    try {
      await Notification.create({
        user: targetUserId,
        title,
        message,
        meta: { transactionId: transaction._id },
      });
    } catch (err) {
      console.error("changeTransactionStatus notification error:", err);
    }

    notifyUser(targetUserId, "notification", {
      type: "transaction_status_changed",
      title,
      message,
      transactionId: transaction._id,
      status,
    });

    return res.json({
      success: true,
      message: `Transaction updated to ${status}`,
      transaction: claimed,
      balance: user?.balance,
    });
  } catch (err) {
    console.error("changeTransactionStatus error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// Helper function to attach the first property image
const attachFirstPropertyImage = (item) => {
  if (item.property) {
    item.property.image =
      item.property.images && item.property.images.length > 0
        ? item.property.images[0]
        : null;
  }
  return item;
};

const getUserTransactionsAndEscrows = async (req, res) => {
  try {
    const userId = req.user._id;

    const [transactions, escrows] = await Promise.all([
      Transaction.find({
        $or: [{ from: userId }, { to: userId }],
      })
        .populate("from", "name email phoneNumber profilePicture")
        .populate("to", "name email phoneNumber profilePicture")
        .lean(),

      Escrow.find({ buyer: userId })
        .populate("property", "title price address images")
        .populate("buyer", "name email phoneNumber profilePicture")
        .populate("seller", "name email phoneNumber profilePicture")
        .lean(),
    ]);

    const taggedTransactions = transactions.map((item) => ({
      ...item,
      recordType: "transaction",
    }));
    const taggedEscrows = escrows.map((item) => {
      attachFirstPropertyImage(item);
      return { ...item, recordType: "escrow" };
    });

    const allActivities = [...taggedTransactions, ...taggedEscrows];
    allActivities.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    return res.json({
      success: true,
      count: allActivities.length,
      activities: allActivities,
    });
  } catch (err) {
    console.error("getUserTransactionsAndEscrows error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// Hides unpaid/draft inspections (`none`, `inspection_requested`, `inspection_initialized`) and purchases (`none`)
const getUserPurchasesAndInspections = async (req, res) => {
  try {
    const userId = req.user._id;

    const [purchases, inspections] = await Promise.all([
      Purchase.find({
        buyer: userId,
        status: { $nin: ["none"] },
      })
        .populate("property", "title price address images")
        .populate("buyer", "name email phoneNumber profilePicture")
        .populate("owner", "name email phoneNumber profilePicture")
        .lean(),

      Inspection.find({
        user: userId,
        status: {
          $nin: ["none", "inspection_requested", "inspection_initialized"],
        },
      })
        .populate("property", "title price address images")
        .populate("user", "name email phoneNumber profilePicture")
        .populate("owner", "name email phoneNumber profilePicture")
        .lean(),
    ]);

    const taggedPurchases = purchases.map((item) => {
      attachFirstPropertyImage(item);
      return { ...item, recordType: "purchase" };
    });
    const taggedInspections = inspections.map((item) => {
      attachFirstPropertyImage(item);
      return { ...item, recordType: "inspection" };
    });

    const allActivities = [...taggedPurchases, ...taggedInspections];
    allActivities.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    return res.json({
      success: true,
      count: allActivities.length,
      activities: allActivities,
    });
  } catch (err) {
    console.error("getUserPurchasesAndInspections error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

const getAgentTransactionsAndEscrows = async (req, res) => {
  try {
    const agentId = req.params.agentId || req.user._id;

    const [transactions, escrows] = await Promise.all([
      Transaction.find({
        $or: [{ to: agentId }, { from: agentId }],
      })
        .populate("from", "name email phoneNumber profilePicture")
        .populate("to", "name email phoneNumber profilePicture")
        .lean(),

      Escrow.find({ seller: agentId })
        .populate("property", "title price address images")
        .populate("buyer", "name email phoneNumber profilePicture")
        .populate("seller", "name email phoneNumber profilePicture")
        .lean(),
    ]);

    const taggedTransactions = transactions.map((item) => ({
      ...item,
      recordType: "transaction",
    }));
    const taggedEscrows = escrows.map((item) => {
      attachFirstPropertyImage(item);
      return { ...item, recordType: "escrow" };
    });

    const allActivities = [...taggedTransactions, ...taggedEscrows];
    allActivities.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    const agentPayments = transactions.filter(
      (t) =>
        t.to?.toString() === agentId.toString() && t.type === "agent_payment",
    );
    const totalEarned = agentPayments.reduce(
      (sum, t) => sum + (t.amount || 0),
      0,
    );

    return res.json({
      success: true,
      count: allActivities.length,
      totalEarned,
      activities: allActivities,
    });
  } catch (err) {
    console.error("getAgentTransactionsAndEscrows error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

const getAgentPurchasesAndInspections = async (req, res) => {
  try {
    const agentId = req.params.agentId || req.user._id;

    const [purchases, inspections] = await Promise.all([
      Purchase.find({
        owner: agentId,
        status: { $nin: ["none"] },
      })
        .populate("property", "title price address images")
        .populate("buyer", "name email phoneNumber profilePicture")
        .populate("owner", "name email phoneNumber profilePicture")
        .lean(),

      Inspection.find({
        owner: agentId,
        status: {
          $nin: ["none", "inspection_requested", "inspection_initialized"],
        },
      })
        .populate("property", "title price address images")
        .populate("user", "name email phoneNumber profilePicture")
        .populate("owner", "name email phoneNumber profilePicture")
        .lean(),
    ]);

    const taggedPurchases = purchases.map((item) => {
      attachFirstPropertyImage(item);
      return { ...item, recordType: "purchase" };
    });
    const taggedInspections = inspections.map((item) => {
      attachFirstPropertyImage(item);
      return { ...item, recordType: "inspection" };
    });

    const allActivities = [...taggedPurchases, ...taggedInspections];
    allActivities.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    return res.json({
      success: true,
      count: allActivities.length,
      activities: allActivities,
    });
  } catch (err) {
    console.error("getAgentPurchasesAndInspections error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

const getAllTransactionsAndEscrows = async (req, res) => {
  try {
    const [transactions, escrows] = await Promise.all([
      Transaction.find()
        .populate("from", "name email phoneNumber profilePicture")
        .populate("to", "name email phoneNumber profilePicture")
        .lean(),

      Escrow.find()
        .populate("property", "title price address images")
        .populate("buyer", "name email phoneNumber profilePicture")
        .populate("seller", "name email phoneNumber profilePicture")
        .lean(),
    ]);

    const taggedTransactions = transactions.map((item) => ({
      ...item,
      recordType: "transaction",
    }));
    const taggedEscrows = escrows.map((item) => {
      attachFirstPropertyImage(item);
      return { ...item, recordType: "escrow" };
    });

    const allActivities = [...taggedTransactions, ...taggedEscrows];
    allActivities.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    return res.json({
      success: true,
      count: allActivities.length,
      activities: allActivities,
    });
  } catch (err) {
    console.error("getAllTransactionsAndEscrows error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

const getAllPurchasesAndInspections = async (req, res) => {
  try {
    const [purchases, inspections] = await Promise.all([
      Purchase.find({
        status: { $nin: ["none", "property_payment_review"] },
      })
        .populate("property", "title price address images")
        .populate("buyer", "name email phoneNumber profilePicture")
        .populate("owner", "name email phoneNumber profilePicture")
        .lean(),

      Inspection.find({
        status: {
          $nin: ["none", "inspection_requested", "inspection_initialized"],
        },
      })
        .populate("property", "title price address images")
        .populate("user", "name email phoneNumber profilePicture")
        .populate("owner", "name email phoneNumber profilePicture")
        .lean(),
    ]);

    const taggedPurchases = purchases.map((item) => {
      attachFirstPropertyImage(item);
      return { ...item, recordType: "purchase" };
    });
    const taggedInspections = inspections.map((item) => {
      attachFirstPropertyImage(item);
      return { ...item, recordType: "inspection" };
    });

    const allActivities = [...taggedPurchases, ...taggedInspections];
    allActivities.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    return res.json({
      success: true,
      count: allActivities.length,
      activities: allActivities,
    });
  } catch (err) {
    console.error("getAllPurchasesAndInspections error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ---------------------------
// 4️⃣ Request Agent Withdrawal (Saves Bank Details Snapshot)
// ---------------------------
const requestWithdrawal = async (req, res) => {
  try {
    const { amount, bankDetails } = req.body;
    const userId = req.user._id;

    if (!amount || amount <= 0) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid withdrawal amount" });
    }

    if (!bankDetails || !bankDetails.accountNumber || !bankDetails.bankName) {
      return res.status(400).json({
        success: false,
        message:
          "Destination bank details (bankName, accountNumber, accountName) are required",
      });
    }

    const user = await User.findById(userId);
    if (!user || user.role !== "agent") {
      return res.status(403).json({
        success: false,
        message: "Access denied. Only agents can request withdrawals.",
      });
    }

    // if (user.balance < amount) {
    //   return res
    //     .status(400)
    //     .json({ success: false, message: "Insufficient wallet balance" });
    // }

    // const reference = crypto.randomBytes(16).toString("hex");

    // const transaction = await Transaction.create({
    //   from: userId,
    //   to: userId,
    //   amount,
    //   type: "withdrawal",
    //   status: "pending",
    //   reference,
    //   bankDetails: {
    //     bankName: bankDetails.bankName,
    //     bankCode: bankDetails.bankCode || "",
    //     accountNumber: bankDetails.accountNumber,
    //     accountName: bankDetails.accountName || user.name,
    //   },
    // });

    // // Deduct from agent wallet atomically
    // // user.balance -= amount;
    // // await user.save();
    // const usersave = await User.findOneAndUpdate(
    //   { _id: userId, role: "agent", balance: { $gte: amount } },
    //   { $inc: { balance: -amount } },
    //   { new: true },
    // );
    // if (!usersave) {
    //   return res
    //     .status(400)
    //     .json({ success: false, message: "Insufficient wallet balance" });
    // }

    // Check and take the money in one step, BEFORE recording the withdrawal

    const usersave = await User.findOneAndUpdate(
      { _id: userId, role: "agent", balance: { $gte: Number(amount) } },
      { $inc: { balance: -Number(amount) } },
      { new: true },
    );
    if (!usersave) {
      return res
        .status(400)
        .json({ success: false, message: "Insufficient wallet balance" });
    }
    // the notification and response below read user.balance
    user.balance = usersave.balance;

    const reference = crypto.randomBytes(16).toString("hex");

    let transaction;
    try {
      transaction = await Transaction.create({
        from: userId,
        to: userId,
        amount,
        type: "withdrawal",
        status: "pending",
        reference,
        bankDetails: {
          bankName: bankDetails.bankName,
          bankCode: bankDetails.bankCode || "",
          accountNumber: bankDetails.accountNumber,
          accountName: bankDetails.accountName || user.name,
        },
      });
    } catch (createErr) {
      // put the money back if the withdrawal couldn't be recorded
      await User.findByIdAndUpdate(userId, {
        $inc: { balance: Number(amount) },
      });
      throw createErr;
    }

    await Notification.create({
      user: userId,
      title: "Withdrawal Requested",
      message: `Your withdrawal request of ₦${amount} has been submitted.`,
      meta: { transactionId: transaction._id },
    });

    notifyUser(userId, "notification", {
      type: "withdrawal_requested",
      title: "New Withdrawal Request",
      message: `Withdrawal request of ₦${amount} submitted successfully.`,
      balance: user.balance,
      transactionId: transaction._id,
    });

    // tell the admins: the payouts page (and its sidebar count) refreshes on this
    const admins = await User.find({ role: "admin" }).select("_id");
    const adminMessage = `${user.name || "An agent"} requested a withdrawal of ₦${Number(amount).toLocaleString()}.`;
    for (const admin of admins) {
      await Notification.create({
        user: admin._id,
        title: "New Withdrawal Request",
        message: adminMessage,
        meta: { transactionId: transaction._id },
      });
      notifyUser(admin._id, "notification", {
        type: "withdrawal_requested",
        title: "New Withdrawal Request",
        message: adminMessage,
        transactionId: transaction._id,
      });
    }

    return res.status(201).json({
      success: true,
      message: "Withdrawal request submitted successfully",
      balance: user.balance,
      transaction,
    });
  } catch (err) {
    console.error("requestWithdrawal error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = {
  recordWalletFunding,
  walletFunding,
  confirmFundWallet,
  verifyWalletFunding,
  payAgent,
  changeTransactionStatus,
  getUserTransactionsAndEscrows,
  getAgentTransactionsAndEscrows,
  getAllTransactionsAndEscrows,
  getUserPurchasesAndInspections,
  getAgentPurchasesAndInspections,
  getAllPurchasesAndInspections,
  requestWithdrawal,
};
```

### `controllers/property.js`

```js
const Property = require("../models/property.js");
const User = require("../models/user");
const Notification = require("../models/notification");
const { uploadImages, uploadVideos } = require("../middlewares/cloudinary");

const { calculatePlatformFee } = require("../middlewares/platformFee");

const {
  stopAdsForProperty,
  pauseAdsForProperty,
} = require("../middlewares/adBilling");

const Purchase = require("../models/purchase");

// A buyer has paid (or their payment is under review) for these
const TAKEN_STATUSES = [
  "property_payment_made",
  "handover_requested",
  "handover_scheduled",
  "handover_rescheduled",
  "handover_confirmed",
  "handover_completed",
  "funds_released",
];

// Ids of properties another buyer can no longer pay for
const getTakenPropertyIds = async (propertyIds) => {
  const filter = {
    $or: [{ holdsProperty: true }, { status: { $in: TAKEN_STATUSES } }],
  };
  if (propertyIds) filter.property = { $in: propertyIds };
  const ids = await Purchase.distinct("property", filter);
  return new Set(ids.map((id) => id.toString()));
};

/**
 * Helper function to sanitize/filter internal property fields for non-owners/non-admins
 */
// const sanitizePropertyForUser = (propObj, userId, userRole) => {
//   if (!propObj) return propObj;

//   const ownerId = propObj.owner?._id
//     ? propObj.owner._id.toString()
//     : propObj.owner?.toString();
//   const isOwner = userId && ownerId && userId.toString() === ownerId;
//   const isAdmin = userRole === "admin";

//   // If not owner and not admin, strip internal sensitive fields
//   if (!isOwner && !isAdmin) {
//     delete propObj.adminNotes;
//     delete propObj.flagReason;
//     delete propObj.statusHistory;
//     delete propObj.rejectionReason;
//   }
//   return propObj;
// };

const sanitizePropertyForUser = (propObj, userId, userRole) => {
  if (!propObj) return propObj;

  const ownerId = propObj.owner?._id
    ? propObj.owner._id.toString()
    : propObj.owner?.toString();

  const isOwner = userId && ownerId && userId.toString() === ownerId;
  const isAdmin = userRole === "admin";

  // 1. adminNotes are STRICTLY for admins only (even the owner cannot see them)
  if (!isAdmin) {
    delete propObj.adminNotes;
  }

  // 2. Strip other internal audit/dispute fields for anyone who isn't the owner or admin
  if (!isOwner && !isAdmin) {
    delete propObj.flagReason;
    delete propObj.statusHistory;
    delete propObj.rejectionReason;
  }

  return propObj;
};

/**
 * @desc Create a new property
 */
const createProperty = async (req, res) => {
  try {
    const {
      title,
      description,
      price,
      escrowFee,
      address,
      propertyType,
      listingType,
      landSize,
      landUnit,
      landCondition,
      landDocTitle,
      landType,
      bedroom,
      bathroom,
      kitchen,
      inspectionFee,
      serviceCharge,
      nearbyPlaces,
      ownerId,
    } = req.body;

    const loggedInUser = req.user;
    let targetOwnerUser = loggedInUser;

    if (loggedInUser.role === "admin" && ownerId) {
      const targetAgent = await User.findById(ownerId);
      if (!targetAgent) {
        return res.status(404).json({
          success: false,
          message: "Target agent user not found.",
        });
      }
      targetOwnerUser = targetAgent;
    }

    const owner = {
      _id: targetOwnerUser._id,
      name: targetOwnerUser.name,
      profilePicture: targetOwnerUser.profilePicture || null,
      isVerified: targetOwnerUser.isVerified || false,
      rating: targetOwnerUser.rating || 0,
      totalListings: targetOwnerUser.totalListings || 0,
    };

    const images = req.files?.images
      ? await uploadImages(req.files.images)
      : [];

    const legalDocuments = req.files?.legalDocuments
      ? await uploadImages(req.files.legalDocuments)
      : [];

    const videos = req.files?.videos
      ? await uploadVideos(req.files.videos)
      : [];

    const prop = await Property.create({
      title,
      description,
      price,
      // ignore any escrowFee in the request: the server works it out
      escrowFee: calculatePlatformFee(price, listingType),
      address,
      propertyType,
      listingType,
      landSize: propertyType === "land" ? landSize : null,
      landUnit: propertyType === "land" ? landUnit : null,
      landCondition: propertyType === "land" ? landCondition : null,
      landDocTitle: propertyType === "land" ? landDocTitle : null,
      landType: propertyType === "land" ? landType : null,
      legalDocuments: legalDocuments,
      bedroom: propertyType !== "land" ? bedroom : null,
      bathroom: propertyType !== "land" ? bathroom : null,
      kitchen: propertyType !== "land" ? kitchen : null,
      inspectionFee,
      serviceCharge,
      nearbyPlaces: nearbyPlaces || [],
      images,
      videos,
      owner,
    });

    await Notification.create({
      user: targetOwnerUser._id,
      title: "Property Created",
      message: `Your property "${title}" was created successfully.`,
      meta: { propertyId: prop._id },
    });

    if (global.io) {
      global.io.emit("notification", {
        type: "property_created",
        title: "New Property Listed",
        message: `New property "${title}" just got listed.`,
        propertyId: prop._id,
      });
    }

    return res.status(201).json({ success: true, property: prop });
  } catch (err) {
    console.error("createProperty error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * @desc Get all properties
 */
const getAllProperties = async (req, res) => {
  try {
    const props = await Property.find().sort({ createdAt: -1 }).lean();

    const userId = req.user?._id;
    const userRole = req.user?.role;

    const taken = await getTakenPropertyIds();
    const sanitizedProps = props.map((p) => ({
      ...sanitizePropertyForUser(p, userId, userRole),
      isTaken: taken.has(p._id.toString()),
    }));

    res.json({ success: true, properties: sanitizedProps });
  } catch (err) {
    console.error("listProperties error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/**
 * @desc Get all properties for a specific agent
 */
const getAgentProperties = async (req, res) => {
  try {
    const requestedAgentId = req.params.id;
    const props = await Property.find({
      "owner._id": requestedAgentId,
    }).lean();

    const userId = req.user?._id;
    const userRole = req.user?.role;

    const taken = await getTakenPropertyIds(props.map((p) => p._id));
    const sanitizedProps = props.map((p) => ({
      ...sanitizePropertyForUser(p, userId, userRole),
      isTaken: taken.has(p._id.toString()),
    }));

    res.json({
      success: true,
      count: sanitizedProps.length,
      properties: sanitizedProps,
    });
  } catch (err) {
    console.error("getAgentProperties error:", err);
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

/**
 * @desc Get single property
 */
const getProperty = async (req, res) => {
  try {
    const prop = await Property.findById(req.params.id)
      .populate("owner", "name email phoneNumber profilePicture")
      .lean();

    if (!prop)
      return res
        .status(404)
        .json({ success: false, message: "Property not found" });

    if (req.user && req.user._id) {
      const viewerId = req.user._id.toString();
      const viewerRole = req.user.role;

      const ownerId = prop.owner?._id
        ? prop.owner._id.toString()
        : prop.owner?.toString();

      const isOwner = viewerId === ownerId;
      const isAdmin = viewerRole === "admin";

      // a view is not saved as a notification (one per view filled every
      // agent's notifications), and the live event goes to the owner only,
      // not to everyone connected
      if (!isOwner && !isAdmin && global.io && ownerId) {
        global.io.to(ownerId).emit("notification", {
          type: "property_viewed",
          title: "Property Viewed",
          message: `Someone viewed "${prop.title}".`,
          propertyId: prop._id,
        });
      }
    }

    const userId = req.user?._id;
    const userRole = req.user?.role;
    const taken = await getTakenPropertyIds([prop._id]);
    const sanitizedProp = {
      ...sanitizePropertyForUser(prop, userId, userRole),
      isTaken: taken.has(prop._id.toString()),
    };

    res.json({ success: true, property: sanitizedProp });
  } catch (err) {
    console.error("getProperty error:", err);
    res
      .status(500)
      .json({ success: false, message: "Server error", error: err.message });
  }
};

/**
 * @desc Update property (Automatically resets rejected properties back to pending)
 */
const updateProperty = async (req, res) => {
  try {
    const prop = await Property.findById(req.params.id);
    if (!prop) {
      return res
        .status(404)
        .json({ success: false, message: "Property not found" });
    }

    if (prop.status === "sold") {
      return res.status(400).json({
        success: false,
        message:
          "This property has been sold, so it can't be edited. To list it again, create a new property.",
      });
    }

    if (
      prop.owner._id.toString() !== req.user._id.toString() &&
      req.user.role !== "admin"
    ) {
      return res
        .status(403)
        .json({ success: false, message: "Not authorized" });
    }

    const {
      title,
      description,
      price,
      escrowFee,
      address,
      propertyType,
      listingType,
      landSize,
      landUnit,
      landCondition,
      landDocTitle,
      landType,
      bedroom,
      bathroom,
      kitchen,
      inspectionFee,
      serviceCharge,
      nearbyPlaces,
    } = req.body;

    if (title !== undefined) prop.title = title;
    if (description !== undefined) prop.description = description;
    if (price !== undefined) prop.price = price;
    // if (escrowFee !== undefined) prop.escrowFee = escrowFee;
    // it's worked out below, after the price and listing type are updated
    if (address !== undefined) prop.address = address;
    if (propertyType !== undefined) prop.propertyType = propertyType;
    if (listingType !== undefined) prop.listingType = listingType;
    // keep the platform fee in step with the (possibly new) price and listing type
    prop.escrowFee = calculatePlatformFee(prop.price, prop.listingType);
    if (inspectionFee !== undefined) prop.inspectionFee = inspectionFee;
    if (serviceCharge !== undefined) prop.serviceCharge = serviceCharge;

    if (nearbyPlaces !== undefined) {
      try {
        prop.nearbyPlaces =
          typeof nearbyPlaces === "string"
            ? JSON.parse(nearbyPlaces)
            : nearbyPlaces;
      } catch (e) {
        prop.nearbyPlaces =
          typeof nearbyPlaces === "string"
            ? nearbyPlaces.split(",").map((s) => s.trim())
            : nearbyPlaces;
      }
    }

    const activePropertyType = propertyType || prop.propertyType;

    if (activePropertyType === "land") {
      if (landSize !== undefined) prop.landSize = landSize;
      if (landUnit !== undefined) prop.landUnit = landUnit;
      if (landCondition !== undefined) prop.landCondition = landCondition;
      if (landDocTitle !== undefined) prop.landDocTitle = landDocTitle;
      if (landType !== undefined) prop.landType = landType;

      prop.bedroom = null;
      prop.bathroom = null;
      prop.kitchen = null;
    } else {
      if (bedroom !== undefined) prop.bedroom = bedroom;
      if (bathroom !== undefined) prop.bathroom = bathroom;
      if (kitchen !== undefined) prop.kitchen = kitchen;

      prop.landSize = null;
      prop.landUnit = null;
      prop.landCondition = null;
      prop.landDocTitle = null;
      prop.landType = null;
    }

    if (req.files?.images) {
      const newImages = await uploadImages(req.files.images);
      prop.images.push(...newImages);
    }

    if (req.files?.legalDocuments) {
      const newLegalDocs = await uploadImages(req.files.legalDocuments);
      prop.legalDocuments.push(...newLegalDocs);
    }

    if (req.files?.videos) {
      const newVideos = await uploadVideos(req.files.videos);
      if (newVideos && newVideos.length > 0) {
        prop.videos.push(...newVideos);
      }
    }

    // If listing was rejected, editing resets it to pending and clears rejectionReason
    if (prop.status === "rejected") {
      prop.status = "pending";
      prop.rejectionReason = undefined;
    }

    await prop.save();

    await Notification.create({
      user: prop.owner._id,
      title: "Property Updated",
      message: `Your property "${prop.title}" was updated successfully.`,
      meta: { propertyId: prop._id },
    });

    if (global.io) {
      global.io.emit("notification", {
        type: "property_updated",
        title: "Property Updated",
        message: `Property "${prop.title}" was updated.`,
        propertyId: prop._id,
      });
    }

    res.status(200).json({ success: true, property: prop });
  } catch (err) {
    console.error("updateProperty error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * @desc Delete property
 */
const deleteProperty = async (req, res) => {
  try {
    const prop = await Property.findById(req.params.id);
    if (!prop)
      return res
        .status(404)
        .json({ success: false, message: "Property not found" });

    if (
      prop.owner.toString() !== req.user._id.toString() &&
      req.user.role !== "admin"
    ) {
      return res
        .status(403)
        .json({ success: false, message: "Not authorized" });
    }

    if (prop.status === "sold") {
      return res.status(400).json({
        success: false,
        message:
          "This property has been sold, so it can't be deleted. The buyer's transaction still refers to it.",
      });
    }

    // stop any ad on it first, so its unused days go to the agent's ad credit
    await stopAdsForProperty(prop._id, "property_deleted");

    await prop.deleteOne();

    await Notification.create({
      user: prop.owner,
      title: "Property Deleted",
      message: `Your property "${prop.title}" was deleted.`,
      meta: { propertyId: prop._id },
    });

    if (global.io)
      global.io.emit("notification", {
        type: "property_deleted",
        title: "Property Deleted",
        message: `Property "${prop.title}" has been deleted.`,
        propertyId: prop._id,
      });

    res.json({ success: true, message: "Property deleted successfully" });
  } catch (err) {
    console.error("deleteProperty error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/**
 * @desc Change property status (Admin only)
 */
const changePropertyStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, reason } = req.body;

    const validStatuses = ["pending", "approved", "rejected"];

    if (!status || !validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Invalid status. Status must be one of: ${validStatuses.join(", ")}`,
      });
    }

    if (req.user.role !== "admin") {
      return res.status(403).json({
        success: false,
        message: "Access denied. Only admins can update property status.",
      });
    }

    const property = await Property.findById(id);
    if (!property) {
      return res.status(404).json({
        success: false,
        message: "Property not found",
      });
    }

    if (property.status === "sold") {
      return res.status(400).json({
        success: false,
        message:
          "This property has been sold. Its status is set by the purchase and can't be changed here.",
      });
    }

    property.status = status;

    if (status === "rejected") {
      property.rejectionReason =
        reason || "Your property listing was rejected.";
    } else {
      // Clear rejectionReason when approved or set back to pending
      property.rejectionReason = undefined;
    }

    // await property.save();

    // let notificationMessage = `Your property "${property.title}" has been ${status}.`;
    await property.save();

    // ads only run on approved listings: a rejected one stops (unused days to
    // ad credit); one sent back to review is paused until it's approved again
    if (status === "rejected") {
      await stopAdsForProperty(property._id, "property_rejected");
    } else if (status === "pending") {
      await pauseAdsForProperty(property._id);
    }

    let notificationMessage = `Your property "${property.title}" has been ${status}.`;

    if (status === "rejected" && property.rejectionReason) {
      notificationMessage += ` Reason: ${property.rejectionReason}`;
    }

    await Notification.create({
      user: property.owner,
      title: `Property ${status.charAt(0).toUpperCase() + status.slice(1)}`,
      message: notificationMessage,
      meta: { propertyId: property._id },
    });

    if (global.io) {
      global.io.emit("notification", {
        type: `property_${status}`,
        title: `Property ${status.charAt(0).toUpperCase() + status.slice(1)}`,
        message: notificationMessage,
        propertyId: property._id,
      });
    }

    return res.status(200).json({
      success: true,
      message: `Property status successfully updated to '${status}'`,
      data: property,
    });
  } catch (err) {
    console.error("changePropertyStatus error:", err);

    if (err.kind === "ObjectId") {
      return res.status(400).json({
        success: false,
        message: "Invalid property ID format",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Server error",
      error: err.message,
    });
  }
};

/**
 * @desc Flag or unflag a property listing (Admin only)
 */
const flagProperty = async (req, res) => {
  try {
    const { id } = req.params;
    const { flagged, reason } = req.body;

    if (req.user.role !== "admin") {
      return res.status(403).json({
        success: false,
        message: "Access denied. Only admins can flag property listings.",
      });
    }

    if (typeof flagged !== "boolean") {
      return res.status(400).json({
        success: false,
        message: "The 'flagged' field must be a boolean (true or false).",
      });
    }

    const property = await Property.findById(id);
    if (!property) {
      return res.status(404).json({
        success: false,
        message: "Property not found",
      });
    }

    property.isFlagged = flagged;
    property.flagReason = flagged ? reason || "No reason provided" : null;
    // property.flaggedAt = flagged ? new Date() : null;

    // await property.save();

    property.flaggedAt = flagged ? new Date() : null;

    await property.save();

    // a flagged listing can't carry an ad: it stops, unused days to ad credit
    if (flagged) {
      await stopAdsForProperty(property._id, "property_flagged");
    }

    return res.status(200).json({
      success: true,
      message: flagged
        ? "Property successfully flagged"
        : "Property unflagged successfully",
      property,
    });
  } catch (err) {
    console.error("flagProperty error:", err);

    if (err.kind === "ObjectId") {
      return res.status(400).json({
        success: false,
        message: "Invalid property ID format",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Server error",
      error: err.message,
    });
  }
};

/**
 * @desc Add an admin note to a property listing & notify the agent privately
 */
// const addAdminNote = async (req, res) => {
//   try {
//     const { propertyId } = req.params;
//     const { note } = req.body;

//     if (!note || !note.trim()) {
//       return res.status(400).json({
//         success: false,
//         message: "Note content cannot be empty.",
//       });
//     }

//     if (req.user.role !== "admin") {
//       return res.status(403).json({
//         success: false,
//         message: "Access denied. Only admins can add notes.",
//       });
//     }

//     const property = await Property.findById(propertyId).populate("owner");
//     if (!property) {
//       return res.status(404).json({
//         success: false,
//         message: "Property not found",
//       });
//     }

//     const newNote = {
//       note,
//       author: {
//         _id: req.user._id,
//         name: req.user.name,
//       },
//       createdAt: new Date(),
//     };

//     property.adminNotes.push(newNote);
//     await property.save();

//     const savedNote = property.adminNotes[property.adminNotes.length - 1];

//     // Notify agent/owner privately (targeted socket instead of global broadcast)
//     const ownerId = property.owner?._id || property.owner;
//     if (ownerId) {
//       const notificationMessage = `An admin left a note on your property "${property.title}": "${note}"`;

//       const notif = await Notification.create({
//         user: ownerId,
//         title: "New Admin Note",
//         message: notificationMessage,
//         meta: { propertyId: property._id },
//       });

//       const ownerSocketId = global.onlineUsers?.get(ownerId.toString());
//       if (ownerSocketId && global.io) {
//         global.io.to(ownerSocketId).emit("notification", notif);
//       }
//     }

//     return res.status(200).json({
//       success: true,
//       note: savedNote,
//     });
//   } catch (err) {
//     console.error("addAdminNote error:", err);
//     return res.status(500).json({ success: false, message: err.message });
//   }
// };

/**
 * @desc Add an admin note to a property listing (Internal admin log only)
 * @route POST /api/properties/:propertyId/notes
 */
const addAdminNote = async (req, res) => {
  try {
    const { propertyId } = req.params;
    const { note } = req.body;

    if (!note || !note.trim()) {
      return res.status(400).json({
        success: false,
        message: "Note content cannot be empty.",
      });
    }

    if (req.user.role !== "admin") {
      return res.status(403).json({
        success: false,
        message: "Access denied. Only admins can add notes.",
      });
    }

    const property = await Property.findById(propertyId);
    if (!property) {
      return res.status(404).json({
        success: false,
        message: "Property not found",
      });
    }

    const newNote = {
      note,
      author: {
        _id: req.user._id,
        name: req.user.name,
      },
      createdAt: new Date(),
    };

    property.adminNotes.push(newNote);
    await property.save();

    const savedNote = property.adminNotes[property.adminNotes.length - 1];

    // NOTE: Notifications and socket events have been completely removed.
    // Admin notes remain strictly internal for dispute logging.

    return res.status(200).json({
      success: true,
      note: savedNote,
    });
  } catch (err) {
    console.error("addAdminNote error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * @desc Update an existing admin note
 */
const updateAdminNote = async (req, res) => {
  try {
    const { propertyId, noteId } = req.params;
    const { note } = req.body;

    if (req.user.role !== "admin") {
      return res.status(403).json({
        success: false,
        message: "Access denied. Only admins can update notes.",
      });
    }

    if (!note || !note.trim()) {
      return res.status(400).json({
        success: false,
        message: "Note content cannot be empty.",
      });
    }

    const property = await Property.findById(propertyId);
    if (!property) {
      return res.status(404).json({
        success: false,
        message: "Property not found",
      });
    }

    const targetNote = property.adminNotes.id(noteId);
    if (!targetNote) {
      return res.status(404).json({
        success: false,
        message: "Admin note not found",
      });
    }

    targetNote.note = note;
    await property.save();

    return res.status(200).json({
      success: true,
      note: targetNote,
    });
  } catch (err) {
    console.error("updateAdminNote error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * @desc Delete an admin note
 */
const deleteAdminNote = async (req, res) => {
  try {
    const { propertyId, noteId } = req.params;

    if (req.user.role !== "admin") {
      return res.status(403).json({
        success: false,
        message: "Access denied. Only admins can delete notes.",
      });
    }

    const property = await Property.findById(propertyId);
    if (!property) {
      return res.status(404).json({
        success: false,
        message: "Property not found",
      });
    }

    const targetNote = property.adminNotes.id(noteId);
    if (!targetNote) {
      return res.status(404).json({
        success: false,
        message: "Admin note not found",
      });
    }

    property.adminNotes.pull(noteId);
    await property.save();

    return res.status(200).json({
      success: true,
      message: "Admin note successfully deleted",
    });
  } catch (err) {
    console.error("deleteAdminNote error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = {
  createProperty,
  getAllProperties,
  getAgentProperties,
  getProperty,
  updateProperty,
  deleteProperty,
  changePropertyStatus,
  flagProperty,
  addAdminNote,
  updateAdminNote,
  deleteAdminNote,
};
```

## Optional, later: other notifications that are just noise

These are saved, but they only repeat what the person just did. The frontend now hides them, so this is just database tidying. Delete the `Notification.create` call for each one, and keep any socket events:

- `controllers/auth.js`: "Login Successful", "Google Login", "Verify Your Email", "Verification Code Resent"
- `controllers/favorite.js`: "Added to Favorites", "Removed from Favorites", "Favorites Cleared"
- `controllers/user.js`: "Profile Updated" (to the user), and "User Profile Updated", which goes to **every admin** whenever anyone edits their profile

## How to check

1. **Admin** pays an agent's withdrawal while the agent is logged out. When the agent logs in, the bell shows **Withdrawal Paid** with the bank, and clicking it opens their wallet.
2. **Admin** declines one: **Withdrawal Declined**, and the money is back in the wallet.
3. **A buyer** opens a listing several times. The agent gets **no** "Property Viewed" notifications, and other logged-in users receive no event (check the browser DevTools → Network → WS frames).
