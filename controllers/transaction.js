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

    notifyUser(targetUserId, "notification", {
      type: "transaction_status_changed",
      title: "Transaction Status Updated",
      message: `Your ${transaction.type} status has been updated to ${status}.`,
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
