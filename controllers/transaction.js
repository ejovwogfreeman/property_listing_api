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

    if (!init || !init.success || !init.data?.authorization_url) {
      return res
        .status(400)
        .json({
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
const confirmFundWallet = async (req, res) => {
  try {
    const { reference } = req.body;
    const userId = req.user._id;

    if (!reference) {
      return res
        .status(400)
        .json({ success: false, message: "Reference is required" });
    }

    const verification = await verifyTransaction(reference);
    if (!verification || verification.data.status !== "success") {
      return res
        .status(400)
        .json({
          success: false,
          message: "Payment not successful or verification failed",
        });
    }

    // Check metadata ownership
    const metaUserId = verification.data.metadata?.userId;
    if (
      metaUserId &&
      metaUserId !== userId.toString() &&
      req.user.role !== "admin"
    ) {
      return res
        .status(403)
        .json({ success: false, message: "Unauthorized transaction owner" });
    }

    const targetUserId = metaUserId || userId;
    const paidAmount = verification.data.amount / 100;

    // Idempotency: check if transaction already exists
    let transaction = await Transaction.findOne({ reference });
    if (transaction) {
      return res.json({
        success: true,
        status: transaction.status,
        message: "Transaction already recorded.",
        transaction,
      });
    }

    // Create pending transaction awaiting admin approval
    try {
      transaction = await Transaction.create({
        from: targetUserId,
        to: targetUserId,
        amount: paidAmount,
        type: "wallet_funding",
        status: "pending",
        reference,
      });
    } catch (createErr) {
      if (createErr.code === 11000) {
        transaction = await Transaction.findOne({ reference });
        return res.json({
          success: true,
          status: transaction.status,
          transaction,
        });
      }
      throw createErr;
    }

    await Notification.create({
      user: targetUserId,
      title: "Wallet Funding Payment Received",
      message: `Your payment of ₦${paidAmount} was received and is pending admin approval.`,
      meta: { transactionId: transaction._id },
    });

    notifyUser(targetUserId, "notification", {
      type: "wallet_funding_pending",
      title: "Wallet Funding Pending Review",
      message: `Your wallet funding payment is awaiting admin approval.`,
      transactionId: transaction._id,
    });

    return res.json({
      success: true,
      status: "pending",
      message: "Payment verified and submitted for admin approval.",
      transaction,
    });
  } catch (err) {
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
      return res
        .status(400)
        .json({
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

    const transaction = await Transaction.findById(transactionId);
    if (!transaction) {
      return res.status(404).json({ message: "Transaction not found" });
    }

    if (!["pending", "approved", "declined", "failed"].includes(status)) {
      return res.status(400).json({ message: "Invalid status" });
    }

    const previousStatus = transaction.status;
    const targetUserId = transaction.to || transaction.from;
    const user = await User.findById(targetUserId);

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Withdrawal: Deducted at request time. If moving to failed/declined from pending, return money ONCE.
    if (transaction.type === "withdrawal") {
      if (
        previousStatus === "pending" &&
        (status === "failed" || status === "declined")
      ) {
        user.balance += transaction.amount;
        await user.save();
      } else if (
        previousStatus === "approved" &&
        (status === "failed" || status === "declined")
      ) {
        // If it was already approved and is now marked failed, refund balance back
        user.balance += transaction.amount;
        await user.save();
      }
    } else {
      // Wallet funding / agent payment reversals
      if (
        previousStatus === "approved" &&
        (status === "pending" || status === "failed" || status === "declined")
      ) {
        user.balance -= transaction.amount;
        await user.save();
      } else if (previousStatus === "pending" && status === "approved") {
        user.balance += transaction.amount;
        transaction.approvedAt = new Date();
        await user.save();
      }
    }

    transaction.status = status;
    await transaction.save();

    notifyUser(user._id, "notification", {
      type: "transaction_status_changed",
      title: "Transaction Status Updated",
      message: `Your ${transaction.type} status has been updated to ${status}.`,
      transactionId: transaction._id,
      status,
    });

    return res.json({
      success: true,
      message: `Transaction updated to ${status}`,
      transaction,
      balance: user.balance,
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
        status: { $nin: ["none", "property_payment_review"] },
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

    if (user.balance < amount) {
      return res
        .status(400)
        .json({ success: false, message: "Insufficient wallet balance" });
    }

    const reference = crypto.randomBytes(16).toString("hex");

    const transaction = await Transaction.create({
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

    // Deduct from agent wallet atomically
    user.balance -= amount;
    await user.save();

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
