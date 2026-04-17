const User = require("../models/user");
const Notification = require("../models/notification");
const Transaction = require("../models/transaction");

// ---------------------------
// Wallet Funding
// ---------------------------
const walletFunding = async (req, res) => {
  try {
    const { amount } = req.body;
    const userId = req.user._id;

    if (!amount || amount <= 0) {
      return res.status(400).json({ message: "Invalid amount" });
    }

    // 🔑 Generate unique reference
    const reference = crypto.randomBytes(16).toString("hex");

    // 🧾 Create pending transaction
    const transaction = await Transaction.create({
      from: userId, // user is paying
      to: userId, // wallet funding goes back to same user
      amount,
      type: "wallet_funding",
      status: "pending",
      reference,
    });

    // 🔔 Notify user
    await Notification.create({
      user: userId,
      title: "Wallet Funding Started",
      message: `You initiated a wallet funding of ₦${amount}.`,
      meta: { transactionId: transaction._id },
    });

    // 🔌 Socket event
    if (global.io) {
      global.io.emit("notification", {
        type: "wallet_funding_started",
        title: "Wallet Funding",
        message: `A user started wallet funding.`,
        transactionId: transaction._id,
      });
    }

    // 💳 Initialize Paystack
    const init = await initializeTransaction(
      req.user.email,
      amount * 100,
      reference,
    );

    return res.json({
      success: true,
      authorizationUrl: init.data.authorization_url,
      reference,
      transactionId: transaction._id,
    });
  } catch (err) {
    console.error("walletFunding error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ---------------------------
// Verify Wallet Funding
// ---------------------------
const verifyWalletFunding = async (req, res) => {
  try {
    const { reference } = req.body;

    if (!reference) {
      return res.status(400).json({ message: "Reference is required" });
    }

    // 🔍 Verify with Paystack
    const verification = await verifyTransaction(reference);

    if (verification.data.status !== "success") {
      return res.status(400).json({ message: "Payment not successful" });
    }

    // 🧾 Find transaction
    const transaction = await Transaction.findOne({ reference });

    if (!transaction) {
      return res.status(404).json({ message: "Transaction not found" });
    }

    // 🔒 Ensure correct type
    if (transaction.type !== "wallet_funding") {
      return res.status(400).json({
        message: "Invalid transaction type",
      });
    }

    // 🚫 Prevent double processing
    if (transaction.status === "approved") {
      return res.status(400).json({
        message: "Transaction already verified",
      });
    }

    // 👤 Find user (from field is now correct source of truth)
    const user = await User.findById(transaction.from);

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // 💰 Credit wallet
    user.balance += transaction.amount;
    await user.save();

    // 📊 Update transaction
    transaction.status = "approved";
    transaction.approvedAt = new Date();
    await transaction.save();

    // 🔔 Notify user
    await Notification.create({
      user: user._id,
      title: "Wallet Funded",
      message: `₦${transaction.amount} has been added to your wallet successfully.`,
      meta: { transactionId: transaction._id },
    });

    // 🔌 Socket event
    if (global.io) {
      global.io.emit("notification", {
        type: "wallet_funded",
        title: "Wallet Credited",
        message: `A wallet has been credited successfully.`,
        transactionId: transaction._id,
      });
    }

    return res.json({
      success: true,
      message: "Wallet funded successfully",
      balance: user.balance,
      transaction,
    });
  } catch (err) {
    console.error("verifyWalletFunding error:", err);
    return res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};

const payAgent = async (req, res) => {
  try {
    const { agentId, amount } = req.body;
    const adminId = req.user._id;

    if (!agentId || !amount || amount <= 0) {
      return res.status(400).json({
        message: "Agent and valid amount are required",
      });
    }

    // 👤 Find agent
    const agent = await User.findById(agentId);

    if (!agent) {
      return res.status(404).json({ message: "Agent not found" });
    }

    // 🔑 Generate reference
    const reference = crypto.randomBytes(16).toString("hex");

    // 🧾 Create transaction record
    const transaction = await Transaction.create({
      from: adminId,
      to: agentId,
      amount,
      type: "agent_payment",
      status: "approved", // internal transfer, no Paystack needed
      reference,
      approvedAt: new Date(),
    });

    // 💰 Credit agent wallet
    agent.balance += amount;
    await agent.save();

    // 🔔 Notify agent
    await Notification.create({
      user: agentId,
      title: "You received a payment",
      message: `You have been paid ₦${amount} by admin.`,
      meta: { transactionId: transaction._id },
    });

    // 🔌 Socket event
    if (global.io) {
      global.io.emit("notification", {
        type: "agent_payment",
        title: "Agent Paid",
        message: `An agent has been paid successfully.`,
        transactionId: transaction._id,
      });
    }

    return res.json({
      success: true,
      message: "Agent paid successfully",
      transaction,
      balance: agent.balance,
    });
  } catch (err) {
    console.error("payAgent error:", err);
    return res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};

const changeTransactionStatus = async (req, res) => {
  try {
    const { transactionId, status } = req.body;

    const transaction = await Transaction.findById(transactionId);

    if (!transaction) {
      return res.status(404).json({ message: "Transaction not found" });
    }

    if (!["pending", "approved", "failed"].includes(status)) {
      return res.status(400).json({ message: "Invalid status" });
    }

    const user = await User.findById(transaction.to || transaction.from);

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const previousStatus = transaction.status;

    // ===============================
    // 🔁 APPROVED → PENDING / FAILED (REVERSE MONEY)
    // ===============================
    if (
      previousStatus === "approved" &&
      (status === "pending" || status === "failed")
    ) {
      if (transaction.type === "wallet_funding") {
        user.balance -= transaction.amount;
      }

      if (transaction.type === "agent_payment") {
        user.balance -= transaction.amount;
      }

      await user.save();
    }

    // ===============================
    // ➕ PENDING → APPROVED (APPLY MONEY)
    // ===============================
    if (previousStatus === "pending" && status === "approved") {
      if (transaction.type === "wallet_funding") {
        user.balance += transaction.amount;
      }

      if (transaction.type === "agent_payment") {
        user.balance += transaction.amount;
      }

      await user.save();
      transaction.approvedAt = new Date();
    }

    // ===============================
    // UPDATE TRANSACTION STATUS
    // ===============================
    transaction.status = status;
    await transaction.save();

    return res.json({
      success: true,
      message: `Transaction updated to ${status}`,
      transaction,
      balance: user.balance,
    });
  } catch (err) {
    console.error("changeTransactionStatus error:", err);
    return res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};

const getUserTransactions = async (req, res) => {
  try {
    const userId = req.user._id;

    const transactions = await Transaction.find({
      $or: [{ from: userId }, { to: userId }],
    })
      .populate("from", "name email")
      .populate("to", "name email")
      .sort({ createdAt: -1 });

    return res.json({
      success: true,
      count: transactions.length,
      transactions,
    });
  } catch (err) {
    console.error("getUserTransactions error:", err);
    return res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};

const getAgentTransactions = async (req, res) => {
  try {
    const agentId = req.params.agentId || req.user._id;

    const transactions = await Transaction.find({
      to: agentId,
      type: "agent_payment",
    })
      .populate("from", "name email")
      .populate("to", "name email")
      .sort({ createdAt: -1 });

    return res.json({
      success: true,
      count: transactions.length,
      totalEarned: transactions.reduce((sum, t) => sum + t.amount, 0),
      transactions,
    });
  } catch (err) {
    console.error("getAgentTransactions error:", err);
    return res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};

const getAllTransactions = async (req, res) => {
  try {
    const transactions = await Transaction.find()
      .populate("from", "name email")
      .populate("to", "name email")
      .sort({ createdAt: -1 });

    return res.json({
      success: true,
      count: transactions.length,
      transactions,
    });
  } catch (err) {
    console.error("getAllTransactions error:", err);
    return res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};

module.exports = {
  walletFunding,
  verifyWalletFunding,
  payAgent,
  changeTransactionStatus,
  getUserTransactions,
  getAgentTransactions,
  getAllTransactions,
};
